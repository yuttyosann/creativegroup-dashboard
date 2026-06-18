#!/usr/bin/env python3
"""
Trepoトレンド大賞2026 — メディア掲載 取得スクリプト（実績スコア「メディア掲載」用）

候補名で「Google News（実際の報道）」と「PR TIMES（企業のPR活動）」の掲載件数を取得し、
メディア掲載の素材を出す。標準ライブラリのみ（pip不要）。

使い方:
    # カンマ区切り or スペース区切り
    python3 scripts/media/fetch_media.py "〇〇リップ" "△△グミ"
    # 候補プールDBから書き出したCSVで一括（対象名の列を指定）
    python3 scripts/media/fetch_media.py --csv candidates.csv --col 対象名 --limit 30

オプション:
    --after 2026-01-01   この日以降の報道に限定（既定: 今年1/1。賞は2026実績が対象）
    --no-news            Google Newsをスキップ（PR TIMESのみ）
    --no-prtimes         PR TIMESをスキップ（Google Newsのみ）
    --out PATH           出力CSV（既定: 分析レポート/media_data/<日付>_メディア掲載.csv）

出力: 候補ごとに news_count / prtimes_count / media_signal / suggested_point(1-5)
注意:
  - Google News は news.google.com に接続（社内ネットワークで実行）。
  - PR TIMES の表示総件数は汎用語で上限張り付きになるため、1ページの実リリース数を使う。
  - 低頻度・節度を持って実行（検索の連打をしない）。
"""
import sys, os, csv, time, re, argparse, datetime as dt
import urllib.parse, urllib.request
import xml.etree.ElementTree as ET

UA = "Mozilla/5.0 (compatible; TrepoAwardResearch/1.0)"


def today_str():
    return dt.date.today().isoformat()


def default_after():
    return f"{dt.date.today().year}-01-01"


def http_get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="ignore")


# ---------- Google News（実際の報道件数） ----------
def google_news_count(term, after):
    q = term
    if after:
        q += f" after:{after}"
    url = ("https://news.google.com/rss/search?q="
           + urllib.parse.quote(q) + "&hl=ja&gl=JP&ceid=JP:ja")
    xml = http_get(url)
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return 0, []
    items = root.findall(".//item")
    titles = [ (it.findtext("title") or "").strip() for it in items[:5] ]
    return len(items), titles


# ---------- PR TIMES（企業のPR活動件数） ----------
def prtimes_count(term):
    url = ("https://prtimes.jp/main/action.php?run=html&page=searchkey&search_word="
           + urllib.parse.quote(term))
    html = http_get(url)
    # 1ページに表示される実リリースURLの数（完全な総数ではないが具体的な信号。最大40で頭打ち）
    ids = set(re.findall(r"/main/html/rd/p/[0-9.]+\.html", html))
    # 参考: 表示上の総件数（タグ除去して数値を拾う。汎用語では上限張り付きの可能性あり）
    displayed = None
    i = html.find("検索結果")
    if i != -1:
        window = re.sub(r"<[^>]+>", " ", html[i:i + 120])
        m = re.search(r"([0-9,]+)\s*件", window)
        if m:
            displayed = int(m.group(1).replace(",", ""))
    return len(ids), displayed


def quintile_point(value, sorted_vals):
    if not sorted_vals:
        return ""
    import bisect
    rank = bisect.bisect_left(sorted_vals, value) / max(1, len(sorted_vals) - 1)
    return min(5, max(1, int(rank * 5) + 1))


def read_terms(args):
    if args.csv:
        with open(args.csv, encoding="utf-8") as f:
            text = f.read().lstrip("﻿")
        rows = list(csv.reader(text.splitlines()))
        if not rows:
            return []
        header = rows[0]
        col = header.index(args.col) if (args.col and args.col in header) else 0
        out = []
        for r in rows[1:]:
            if len(r) > col and r[col].strip() and r[col].strip() not in out:
                out.append(r[col].strip())
        return out[:args.limit]
    if args.terms:
        joined = " ".join(args.terms)
        return [t.strip() for t in re.split(r"[,，]", joined) if t.strip()] if "," in joined or "，" in joined \
            else [t.strip() for t in args.terms if t.strip()]
    return []


def main():
    p = argparse.ArgumentParser(description="メディア掲載取得（Trepoトレンド大賞2026）")
    p.add_argument("terms", nargs="*", help="候補名（スペース or カンマ区切り）")
    p.add_argument("--csv", default=None)
    p.add_argument("--col", default=None, help="CSVの候補名列（既定: 先頭列）")
    p.add_argument("--limit", type=int, default=30)
    p.add_argument("--after", default=None, help="この日以降の報道に限定（既定: 今年1/1）")
    p.add_argument("--no-news", action="store_true")
    p.add_argument("--no-prtimes", action="store_true")
    p.add_argument("--out", default=None)
    args = p.parse_args()

    terms = read_terms(args)
    if not terms:
        sys.exit('候補名 or --csv を指定してください（例: "〇〇リップ" "△△グミ"）')
    after = args.after or default_after()

    results = []
    for t in terms:
        nc, ntitles = (0, [])
        pc, pdisp = (0, None)
        if not args.no_news:
            try:
                nc, ntitles = google_news_count(t, after)
            except Exception as e:
                print(f"[warn] news {t}: {e}", file=sys.stderr)
        if not args.no_prtimes:
            try:
                pc, pdisp = prtimes_count(t)
            except Exception as e:
                print(f"[warn] prtimes {t}: {e}", file=sys.stderr)
            time.sleep(1.5)  # 節度
        results.append({"keyword": t, "news_count": nc, "prtimes_count": pc,
                        "prtimes_total": pdisp if pdisp is not None else "",
                        "suggested_point": "", "news_titles": " | ".join(ntitles)})
        print(f"  {t}  news{nc} / prtimes(総){pdisp if pdisp is not None else pc}")

    # ニュースとPR TIMESを「それぞれプール内5分位 → 該当ソースの平均」で1〜5化。
    # （件数スケールが違うため単純合算しない。該当ソースのみで正規化）
    news_used = not args.no_news
    pt_used = not args.no_prtimes
    def pt_measure(r):  # PR TIMESの段階的指標: 総件数優先、無ければ1ページ実数
        return r["prtimes_total"] if isinstance(r["prtimes_total"], int) else r["prtimes_count"]
    news_vals = sorted(r["news_count"] for r in results) if news_used else []
    pt_vals = sorted(pt_measure(r) for r in results) if pt_used else []
    for r in results:
        pts = []
        if news_used:
            pts.append(quintile_point(r["news_count"], news_vals))
        if pt_used:
            pts.append(quintile_point(pt_measure(r), pt_vals))
        pts = [p for p in pts if isinstance(p, int)]
        r["suggested_point"] = round(sum(pts) / len(pts)) if pts else ""
        r["_sort"] = (sum(pts) / len(pts)) if pts else -1
    results.sort(key=lambda r: r["_sort"], reverse=True)

    out = args.out
    if not out:
        d = os.path.join("分析レポート", "media_data")
        os.makedirs(d, exist_ok=True)
        out = os.path.join(d, f"{today_str()}_メディア掲載.csv")
    else:
        os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["keyword", "news_count", "prtimes_count",
                                          "prtimes_total", "suggested_point", "news_titles"],
                           extrasaction="ignore")
        w.writeheader()
        w.writerows(results)
    print(f"\n✅ {len(results)}件 → {out}")
    print("→ suggested_point を候補プールDBの『メディア掲載_点』、news_count/titles を『メディア_根拠』に転記。")
    print("  ※ suggested_point はv0.1の目安。最終点は編集判断で上書き可。")


if __name__ == "__main__":
    main()
