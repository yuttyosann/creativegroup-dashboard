#!/usr/bin/env python3
"""
IG転換質プロキシ — Astreamデータから「買う気の代理指標」を算出

Instagramはコメントベースの転換質が弱い（トップコメントが虚栄主体）ため、
Astreamのエンゲージメント品質指標から転換の代理スコアを設計する。

【設計思想】
  YouTubeの転換質＝コメントの購買意向。IGはそれが効かないので、
  「PR投稿でもエンゲージが落ちない＝信頼が維持され購買につながる」を主軸に、
  実在率・能動性・発見性を組み合わせる。

【スコア構成（100点）】
  A PRエンゲージ水準   30 … PR投稿のエンゲージ率（PRで反応が落ちないか）
  B PR維持率          15 … PRエンゲージ ÷ 通常エンゲージ（広告疲れの有無）
  C フォロワー実在率   25 … bot補正（見せかけの数字を排除）
  D 能動的コミュニティ 15 … コメント/いいね比（購買相談が起きる土壌）
  E 発見性・拡散       15 … フォロワー外からのいいね（新規購買者の獲得力）

※これはv0.1の設計（仮説）。IGの実売結果が未取得のため未検証。
  提案ログDBに採用＋成果が貯まったら較正する（過学習防止の原則）。

使い方:
  python3 scripts/astream/ig_conversion_proxy.py "<AstreamのCSV>"
出力:
  分析レポート/astream_data/ig_proxy_<日付>.csv
"""
import csv, sys, os, datetime

if len(sys.argv) < 2:
    print("使い方: python3 scripts/astream/ig_conversion_proxy.py <AstreamのCSV>")
    sys.exit(1)
src = sys.argv[1]

def num(v):
    if not v: return None
    s = str(v).replace("%","").replace(",","").strip()
    try: return float(s)
    except: return None

def clamp(x, lo, hi): return max(lo, min(hi, x))

rows = list(csv.DictReader(open(src, encoding="utf-8-sig")))
out = []
for r in rows:
    acc = (r.get("アカウント名") or "").strip().lstrip("@")
    if not acc: continue
    pr_eng = num(r.get("PRエンゲージメント"))
    eng    = num(r.get("エンゲージメント")) or num(r.get("いいねエンゲージメント"))
    real   = num(r.get("フォロワー実在率")) or 0
    likes  = num(r.get("直近30投稿の平均いいね数")) or 0
    cmts   = num(r.get("直近30投稿の平均コメント数")) or 0
    out_like = num(r.get("フォロワー外からのいいね")) or 0
    followers = num(r.get("フォロワー数")) or 0

    pr_missing = (pr_eng is None or pr_eng == 0)

    # A PRエンゲージ水準（30）: 0〜5%→0〜30。PR無しは通常エンゲージの半分で代替（上限18）
    if not pr_missing:
        A = clamp(pr_eng/5*30, 0, 30)
    else:
        A = clamp((eng or 0)/5*30*0.5, 0, 18)

    # B PR維持率（15）: PRエンゲージ÷通常エンゲージ。両方ある時のみ、無ければ中央値7.5
    if (pr_eng and eng and eng > 0):
        B = clamp(pr_eng/eng, 0, 1.0) * 15
    else:
        B = 7.5

    # C 実在率（25）: 30〜85%→0〜25
    C = clamp((real-30)/(85-30)*25, 0, 25)

    # D 能動的コミュニティ（15）: コメント/いいね比 0〜2%→0〜15
    ratio = (cmts/likes*100) if likes > 0 else 0
    D = clamp(ratio/2*15, 0, 15)

    # E 発見性（15）: フォロワー外いいね 0〜50%→0〜15
    E = clamp(out_like/50*15, 0, 15)

    total = round(A+B+C+D+E)
    judge = "◎" if total>=75 else "○" if total>=60 else "△" if total>=45 else "×"
    out.append({
        "アカウント名": acc, "フォロワー": int(followers),
        "プロキシ点": total, "判定": judge,
        "A_PRエンゲージ": round(A,1), "B_PR維持": round(B,1), "C_実在率": round(C,1),
        "D_能動性": round(D,1), "E_発見性": round(E,1),
        "PRエンゲージ%": pr_eng if pr_eng is not None else "",
        "実在率%": real, "PRデータ": "不足" if pr_missing else "あり",
    })

out.sort(key=lambda x: x["プロキシ点"], reverse=True)

outdir = "分析レポート/astream_data"
os.makedirs(outdir, exist_ok=True)
date = datetime.date.today().isoformat()
outpath = os.path.join(outdir, f"ig_proxy_{date}.csv")
with open(outpath, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader(); w.writerows(out)

if "--json" in sys.argv:
    import json
    print("@@JSON@@" + json.dumps({"ok": True, "count": len(out), "rows": out[:50]}, ensure_ascii=False))
    raise SystemExit

print(f"\nIG転換質プロキシ（Astreamデータ・{len(out)}名）")
print("="*76)
print("※PR投稿でも反応が落ちないか＋実在率＋能動性＋発見性の合成。v0.1仮説（未検証）\n")
print(f'{"順":>2} {"アカウント":<26} {"点":>3} {"判定":<3} PRエンゲ 実在  内訳(A/B/C/D/E)')
for i, x in enumerate(out[:20]):
    pr = f'{x["PRエンゲージ%"]}%' if x["PRエンゲージ%"]!="" else "—"
    print(f'{i+1:>2} @{x["アカウント名"]:<25} {x["プロキシ点"]:>3} {x["判定"]:<3} '
          f'{pr:>6} {x["実在率%"]:>4.0f} ({x["A_PRエンゲージ"]}/{x["B_PR維持"]}/{x["C_実在率"]}/{x["D_能動性"]}/{x["E_発見性"]})')

print(f"\n✅ 出力: {outpath}")
print("   ※PRデータ不足の人はAが代替値。人間タグ(PRが得意/信頼が厚い)を別途加味すると精度が上がる。")
