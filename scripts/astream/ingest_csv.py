#!/usr/bin/env python3
"""
Astream CSV → インフルエンサーマスタDB 取込スクリプト

Astreamのアカウントリサーチ/競合調査CSVを読み込み、
当社マスタDBのフォーマットに正規化する。
Astreamの客観データ（客層・実在率・興味・PRエンゲージ）が
診断のM04（フォロワー層）/M10（実在率リスク）/M01・M02（興味）を客観で埋める。

※転換質（コメント購買意向）はAstreamに無いため「要スキャン」と記録。
  IGはApify or 手動キャプチャ、当社の転換質スキャンで後付けする。

使い方:
  python3 scripts/astream/ingest_csv.py "<AstreamのCSVパス>"
出力:
  分析レポート/astream_data/master_import_<日付>.csv
"""
import csv, sys, os, datetime, re

if len(sys.argv) < 2:
    print("使い方: python3 scripts/astream/ingest_csv.py <CSVパス>")
    sys.exit(1)

src = sys.argv[1]

def pct(v):
    if v is None: return 0.0
    s = str(v).replace("%", "").strip()
    try: return float(s)
    except: return 0.0

def first_interest(row):
    """フォロワーの興味から美容関連かを推定"""
    interests = " ".join([str(row.get(f"フォロワーの興味{i}位", "")) for i in ["１","２","３","４","５"]])
    return interests

rows = list(csv.DictReader(open(src, encoding="utf-8-sig")))
out = []
for r in rows:
    name = r.get("アカウント名", "").strip()
    if not name: continue
    followers = pct(r.get("フォロワー数"))
    fem = pct(r.get("フォロワーの女性割合"))
    core = pct(r.get("フォロワーの25-34歳の女性の割合")) + pct(r.get("フォロワーの35-44歳の女性の割合"))
    real = pct(r.get("フォロワー実在率"))           # bot検出（M10）
    pr_eng = pct(r.get("PRエンゲージメント"))         # PR投稿のエンゲージ
    eng = pct(r.get("エンゲージメント"))
    interests = first_interest(r)
    is_beauty = ("Beauty" in interests) or ("美容" in str(r.get("よく使う# １位","")) + str(r.get("よく使う# ２位","")))
    # 興味TOP・ブランド属性から適性メモ
    hashtags = "/".join([str(r.get(f"よく使う# {i}位","")) for i in ["１","２","３"] if r.get(f"よく使う# {i}位")])
    brand_aff = "/".join([str(r.get(f"ブランド属性{i}位","")).split("=")[0] for i in ["１","２","３"] if r.get(f"ブランド属性{i}位")])
    tiktok = r.get("TikTok","").strip()
    profile = (r.get("プロフィール","") or "").replace("\n"," ").strip()[:60]

    # 簡易スクリーニング（Astream客観データのみ・転換質は未取得）
    # 客層適合(25)：女性比率＋購買中核
    aud = min(12, max(0, (fem-50)/47*12)) + min(13, core/70*13)
    # 実在率(M10想定の加点)：実在率が高いほど安心
    real_pts = min(10, real/90*10)
    # PRエンゲージ：PR投稿の反応
    pr_pts = min(10, pr_eng/3*10) if pr_eng>0 else 0
    prelim = round(aud + real_pts + pr_pts)  # 45点満点の暫定（転換質・ジャンル等は別途）

    out.append({
        "インフルエンサー": name,
        "媒体": "Instagram",
        "ジャンル推定": "美容" if is_beauty else "要確認",
        "コンテンツ型": "要・転換質スキャン",
        "フォロワー": int(followers),
        "女性%": f"{fem:.0f}%",
        "中核年齢25-44%": f"{core:.0f}%",
        "実在率%": f"{real:.0f}%",
        "PRエンゲージ%": f"{pr_eng:.2f}%",
        "暫定スコア(客層+実在+PR/45)": prelim,
        "転換質%": "未取得",
        "よく使う#": hashtags,
        "ブランド親和": brand_aff,
        "TikTok": tiktok,
        "プロフィール抜粋": profile,
        "URL": r.get("アカウントURL","").strip(),
    })

# 暫定スコア順
out.sort(key=lambda x: x["暫定スコア(客層+実在+PR/45)"], reverse=True)

outdir = "分析レポート/astream_data"
os.makedirs(outdir, exist_ok=True)
date = datetime.date.today().isoformat()
outpath = os.path.join(outdir, f"master_import_{date}.csv")
cols = list(out[0].keys())
with open(outpath, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    w.writerows(out)

if "--json" in sys.argv:
    import json
    print("@@JSON@@" + json.dumps({"ok": True, "count": len(out), "rows": out[:50]}, ensure_ascii=False))
    raise SystemExit

# コンソール要約
print(f"\n取込件数: {len(out)}名")
print("="*78)
print("【暫定スクリーニング上位15名】(Astream客層+実在率+PRエンゲージ / 45点満点)")
print("※転換質(購買意向)は未取得。IGはApify/手動キャプチャ＋当社スキャンで後付け\n")
for i, x in enumerate(out[:15]):
    print(f"{i+1:>2}. {x['インフルエンサー']:<18} 暫定{x['暫定スコア(客層+実在+PR/45)']:>2}/45 "
          f"| {x['フォロワー']:>8,}人 女性{x['女性%']:>4} 中核{x['中核年齢25-44%']:>4} "
          f"実在{x['実在率%']:>4} PR{x['PRエンゲージ%']:>6} {x['ジャンル推定']}")

print(f"\n✅ マスタDB取込用CSV: {outpath}")
print("   次：①このCSVをマスタDBに貼付 ②IG転換質スキャン(Apify/手動)で'転換質%'を埋める ③商品確定でTier2")
