#!/usr/bin/env python3
"""
Trepoトレンド大賞2026 — Google Trends 取得スクリプト（実績スコア「検索の伸び」用）

ジャンル横断のトレンド候補生成（discover）と、候補名ごとの検索の伸び採点（score）を行う。
※Google Trendsは非公式API(pytrends)経由。レート制限・仕様変更で落ちることがある前提で使う。

セットアップ:
    pip install pytrends pandas

使い方:
    # 1) 候補生成: 日本の急上昇検索を取得（ジャンル横断のシード）
    python3 scripts/trends/google_trends.py discover

    # 2) 採点: 候補名の「検索の伸び」を算出（カンマ区切り or CSVの列）
    python3 scripts/trends/google_trends.py score "〇〇リップ,△△グミ,□□カフェ"
    python3 scripts/trends/google_trends.py score --csv candidates.csv --col 対象名

オプション:
    --geo JP            地域（既定 JP）
    --timeframe "2026-01-01 2026-06-17"   期間（既定: 今年1/1〜実行日）
    --anchor "iPhone"   バッチ間比較の基準語（score時のスケール正規化に使用）
    --out PATH          出力CSVパス（既定: 分析レポート/trends_data/<日付>_<mode>.csv）

出力（score）: 候補ごとに
    mean_interest（基準語でスケール）, rising_ratio（直近 vs 前半）, is_breakout, suggested_point(1-5)
出力（discover）: 急上昇キーワード一覧（カテゴリ推定なし。人手でカテゴリ付与→候補プールDBへ）
"""
import sys, os, csv, time, argparse, datetime as dt

try:
    from pytrends.request import TrendReq
except ImportError:
    sys.exit("pytrends が未インストールです。`pip install pytrends pandas` を実行してください。")


def today_str():
    return dt.date.today().isoformat()


def default_timeframe():
    return f"{dt.date.today().year}-01-01 {today_str()}"


def make_client(geo):
    # hl=ja-JP, tz=540(JST)。Google Trends 日本向け。
    return TrendReq(hl="ja-JP", tz=540, geo=geo, timeout=(10, 25), retries=2, backoff_factor=0.5)


def ensure_out(path, mode):
    if path:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        return path
    d = os.path.join("分析レポート", "trends_data")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"{today_str()}_{mode}.csv")


# ---------------- discover: 候補生成（ジャンル横断） ----------------
def cmd_discover(args):
    py = make_client(args.geo)
    rows = []

    # 日次トレンド（一般的だがZ世代トレンドのシードになる）
    try:
        daily = py.trending_searches(pn="japan")  # DataFrame 1列
        for kw in daily[0].tolist():
            rows.append({"source": "daily_trending", "keyword": kw})
    except Exception as e:
        print(f"[warn] trending_searches 失敗: {e}", file=sys.stderr)

    # リアルタイムトレンド（カテゴリ別。entertainment等が拾える）
    try:
        rt = py.realtime_trending_searches(pn="JP")
        col = "title" if "title" in rt.columns else rt.columns[0]
        for kw in rt[col].tolist()[:50]:
            rows.append({"source": "realtime_trending", "keyword": kw})
    except Exception as e:
        print(f"[warn] realtime_trending_searches 失敗: {e}", file=sys.stderr)

    out = ensure_out(args.out, "discover")
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["source", "keyword"])
        w.writeheader()
        w.writerows(rows)
    print(f"取得 {len(rows)} 件 → {out}")
    print("→ 人手でカテゴリを付与し、候補プールDBに『流入経路=編集部リサーチ』で投入してください。")


# ---------------- score: 候補ごとの「検索の伸び」採点 ----------------
def read_candidates(args):
    if args.csv:
        with open(args.csv, encoding="utf-8") as f:
            r = csv.DictReader(f)
            col = args.col or r.fieldnames[0]
            return [row[col].strip() for row in r if row.get(col, "").strip()]
    if args.terms:
        return [t.strip() for t in args.terms.split(",") if t.strip()]
    sys.exit("採点対象がありません。\"a,b,c\" か --csv を指定してください。")


def slope_metrics(series):
    """interest_over_time の1キーワード列から、伸び指標を計算。"""
    vals = [v for v in series.tolist() if v is not None]
    if not vals:
        return 0.0, 0.0
    n = len(vals)
    half = max(1, n // 2)
    earlier = sum(vals[:half]) / half
    recent = sum(vals[half:]) / max(1, n - half)
    rising_ratio = (recent / earlier) if earlier > 0 else (recent if recent > 0 else 0.0)
    mean_interest = sum(vals) / n
    return round(mean_interest, 2), round(rising_ratio, 2)


def quintile_point(value, sorted_vals):
    """プール内パーセンタイルで5分位 → 1〜5点（ランブックのデータアンカー正規化）。"""
    if not sorted_vals:
        return ""
    import bisect
    rank = bisect.bisect_left(sorted_vals, value) / max(1, len(sorted_vals) - 1)
    return min(5, max(1, int(rank * 5) + 1))


def cmd_score(args):
    cands = read_candidates(args)
    py = make_client(args.geo)
    tf = args.timeframe or default_timeframe()
    anchor = args.anchor  # バッチ間の比較基準（任意）

    results = []
    # pytrends は1リクエスト最大5語。anchor を各バッチに入れてスケール正規化する。
    batch_size = 4 if anchor else 5
    for i in range(0, len(cands), batch_size):
        batch = cands[i:i + batch_size]
        kw = batch + ([anchor] if anchor else [])
        try:
            py.build_payload(kw, timeframe=tf, geo=args.geo)
            iot = py.interest_over_time()
        except Exception as e:
            print(f"[warn] batch {batch} 失敗: {e}", file=sys.stderr)
            for b in batch:
                results.append({"keyword": b, "mean_interest": "", "rising_ratio": "",
                                "is_breakout": "", "suggested_point": "", "note": "取得失敗"})
            time.sleep(2)
            continue

        anchor_mean = None
        if anchor and anchor in iot.columns:
            anchor_mean, _ = slope_metrics(iot[anchor])

        # rising 関連クエリで breakout 判定
        try:
            rq = py.related_queries()
        except Exception:
            rq = {}

        for b in batch:
            if b not in iot.columns:
                results.append({"keyword": b, "mean_interest": "", "rising_ratio": "",
                                "is_breakout": "", "suggested_point": "", "note": "データなし"})
                continue
            mean_i, rising = slope_metrics(iot[b])
            # anchor でスケール（バッチ間比較可能に）
            if anchor_mean and anchor_mean > 0:
                mean_i = round(mean_i / anchor_mean * 100, 2)
            breakout = ""
            try:
                rising_df = (rq.get(b) or {}).get("rising")
                if rising_df is not None and "value" in rising_df:
                    breakout = "yes" if (rising_df["value"].astype(str) == "Breakout").any() else ""
            except Exception:
                pass
            results.append({"keyword": b, "mean_interest": mean_i, "rising_ratio": rising,
                            "is_breakout": breakout, "suggested_point": "", "note": ""})
        time.sleep(2)  # レート制限回避

    # rising_ratio のプール内5分位で suggested_point を付与
    valid = sorted([r["rising_ratio"] for r in results if isinstance(r["rising_ratio"], (int, float))])
    for r in results:
        if isinstance(r["rising_ratio"], (int, float)):
            r["suggested_point"] = quintile_point(r["rising_ratio"], valid)

    out = ensure_out(args.out, "score")
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["keyword", "mean_interest", "rising_ratio",
                                          "is_breakout", "suggested_point", "note"])
        w.writeheader()
        w.writerows(results)
    print(f"採点 {len(results)} 件 → {out}")
    print("→ suggested_point(1-5) を候補プールDBの『検索の伸び_点』に、根拠(rising_ratio等)を『検索_根拠』に転記。")
    print("  ※ suggested_point はv0.1の目安。最終点は編集判断で上書き可。")


def main():
    p = argparse.ArgumentParser(description="Google Trends 取得（Trepoトレンド大賞2026）")
    sub = p.add_subparsers(dest="mode", required=True)

    pd_ = sub.add_parser("discover", help="日本の急上昇検索を取得（候補シード）")
    pd_.add_argument("--geo", default="JP")
    pd_.add_argument("--out", default=None)
    pd_.set_defaults(func=cmd_discover)

    ps = sub.add_parser("score", help="候補名の検索の伸びを採点")
    ps.add_argument("terms", nargs="?", help='"a,b,c" 形式の候補名')
    ps.add_argument("--csv", default=None)
    ps.add_argument("--col", default=None, help="CSVの候補名列（既定: 先頭列）")
    ps.add_argument("--geo", default="JP")
    ps.add_argument("--timeframe", default=None)
    ps.add_argument("--anchor", default=None, help="バッチ間比較の基準語")
    ps.add_argument("--out", default=None)
    ps.set_defaults(func=cmd_score)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
