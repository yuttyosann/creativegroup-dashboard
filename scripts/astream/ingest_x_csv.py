#!/usr/bin/env python3
"""
Astream X(旧Twitter) CSV → 候補DB(インフルエンサーDB) 取込スクリプト

Xはスクレイピング上、客層(女性%/年齢/実在率)やコメントベースの転換質が
取れない構造的限界がある。本スクリプトはAstream X CSVで取れる
フォロワー・エンゲージ率・平均反応・プロフィールを正規化して返す。

使い方:
  python3 scripts/astream/ingest_x_csv.py "<X CSVパス>" --json
出力:
  @@JSON@@{"ok":true,"count":N,"rows":[...上位50件]}
"""
import csv, sys, re, json

if len(sys.argv) < 2:
    print("使い方: python3 scripts/astream/ingest_x_csv.py <CSVパス> --json")
    sys.exit(1)

src = sys.argv[1]


def to_int(v):
    """数値文字列(カンマ可)を int に。失敗時は空文字。"""
    s = re.sub(r"[^\d.]", "", str(v or ""))
    if not s:
        return ""
    try:
        return int(float(s))
    except ValueError:
        return ""


def engage_rate(v):
    """'56.33(0.04)' の括弧内(エンゲージ率%)を数値で返す。無ければ空文字。"""
    m = re.search(r"\(([\d.]+)\)", str(v or ""))
    return m.group(1) if m else ""


rows = list(csv.DictReader(open(src, encoding="utf-8-sig")))
out = []
for r in rows:
    account = (r.get("アカウント名", "") or "").strip().lstrip("@")
    if not account:
        continue
    followers = to_int(r.get("フォロワー数"))
    rate = engage_rate(r.get("エンゲージメント"))
    avg_likes = (r.get("平均いいね", "") or "").strip()
    avg_comments = (r.get("平均コメント", "") or "").strip()
    avg_reposts = (r.get("平均リポスト", "") or "").strip()
    avg_imp = (r.get("平均インプレッション", "") or "").strip()
    profile = (r.get("プロフィール", "") or "").replace("\n", " ").strip()
    eng_disp = f"{rate}%" if rate else "—"
    note = (
        f"ENG率{eng_disp} ♡{avg_likes} 💬{avg_comments} "
        f"RT{avg_reposts} Imp{avg_imp} / {profile}"
    )
    out.append({
        "account": account,
        "followers": followers,
        "engageRate": rate,
        "avgLikes": avg_likes,
        "avgComments": avg_comments,
        "avgReposts": avg_reposts,
        "avgImpressions": avg_imp,
        "url": (r.get("URL", "") or "").strip(),
        "profile": profile,
        "note": note,
    })

print("@@JSON@@" + json.dumps(
    {"ok": True, "count": len(out), "rows": out[:50]}, ensure_ascii=False))
