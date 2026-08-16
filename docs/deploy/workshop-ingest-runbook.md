# 勉強会アンケート → 台帳 手順書

対象: `scripts/kizuki/workshop_extract.js` / `scripts/kizuki/workshop_seed.js`
設計: [勉強会アンケート取込 設計書](../superpowers/specs/2026-08-17-kizuki-word-cycle-workshop-ingest.md)
関連: [Pamun取込 手順書](phase3-slice2-pamun-ingest-runbook.md)

勉強会が**気づきワードの本来の起点**。ここで発掘したワードを、あとで Pamun（Track A/B）や
広告で検証していく。

## 前提

- ADC がなりすまし構成でログイン済み（[Pamun手順書 Step 2](phase3-slice2-pamun-ingest-runbook.md)）
- 本体リポジトリをカレントにして実行する（`.env` の `ANTHROPIC_API_KEY` を使うため）

```bash
cd /Users/yuttyo/claude/creativegroup-dashboard
export SHEET_ID=1VxAOesBm_gi_jlSlq39FDtTMZNYOQcBm3J53gw3_g3o
```

## Step 1. 回答シートのIDを控える

RAWデータのフォルダに、フォームと対で「（回答）」スプレッドシートができている。

- 事後アンケート（必須） — 自由記述4問が候補ワードの源泉
- 事前アンケート（任意） — 認知度から `ブランド未認知` を判定する

アベンヌ勉強会（2026/8）の場合:

| | シートID |
|---|---|
| 事後 | `1OJQSBLgx0J0ZVrKGi_7Q4PXojuAzJTQ6e6nb88PAmpk` |
| 事前 | `1BDRR9d_RPXNpgmWz7tBllCkPkrZSfusA4VLNUDIKay0` |

## Step 2. 候補ワードを抽出する

```bash
node .worktrees/kizuki-word-cycle/scripts/kizuki/workshop_extract.js \
  --post 1OJQSBLgx0J0ZVrKGi_7Q4PXojuAzJTQ6e6nb88PAmpk \
  --pre  1BDRR9d_RPXNpgmWz7tBllCkPkrZSfusA4VLNUDIKay0 \
  > candidates.json
```

シートには書き込まない。標準エラーに次が出るので**必ず目を通す**。

```
自由記述の設問: 最も印象が変わった点 / 説明後に初めて理解できたこと / 印象に残った言葉 / 使いたい部位・場面
回答者: 18人
認知度の回答値: 「まったく知らなかった」=未認知 / 「名前は知っていた」 / 「使ったことがある」
未認知と判定した参加者: 7人
候補ワード: 11件
```

> ⚠️ **認知度の判定はフォームの選択肢文言に依存する。**
> 上のログに実際の値が全部出るので、「未認知」と判定すべき選択肢に `=未認知` が付いているか確認する。
> ずれていたら `lib/kizuki/workshop-ingest.js` の `UNAWARE_PATTERNS` を直す。

## Step 3. candidates.json を確認・編集する

ワードの文言はここで直す。不要なワードは配列から削除してよい。

```json
{
  "respondents": 18,
  "unaware": ["a@example.com", "..."],
  "words": [
    { "word": "肌が生き返る感じがする", "axis": "効能",
      "quote": "肌が生き返る", "mentionedBy": ["a@example.com", "b@example.com"] }
  ]
}
```

`mentionedBy` は言及数と `ブランド未認知` の判定に使うので、消さないこと。

## Step 4. 台帳と勉強会シグナルに登録する

```bash
node .worktrees/kizuki-word-cycle/scripts/kizuki/workshop_seed.js candidates.json \
  --case 2026-08-AVENE-CICA --product CICA
```

登録予定が表示される（書き込みなし）。内容を確認して `--apply` を付けて再実行する。

```
case=2026-08-AVENE-CICA / 候補ワード 11件 / 回答者 18人
採番: w016 〜 w026

word_id  言及  未認知  ワード
w016       9  TRUE    肌が生き返る感じがする
...
```

> **`word_id` は台帳全体で一意に採番される。** `aggregateSignals` はシグナルを `word_id` だけで
> 突合し case では絞らないため、別案件で同じIDを振ると**別案件のシグナルが混ざる**。
> 既存の最大値の続きから自動で振るので、手で番号を決めないこと。

同じ case に既にデータがあると中断する（重複登録の防止）。

## Step 5. スコアに反映する

```bash
node .worktrees/kizuki-word-cycle/scripts/kizuki/recalc_job.js
```

BigQuery が未整備でも台帳の再計算は走る（広告取込はスキップされ終了コード1になる）。

## Step 6. この先

勉強会で発掘したワードを検証フェーズに回す。

1. 台帳で検証したいワードの **status を「モニター」に**（5〜8件）
2. `tracka_questions.js` で3択設問を出し、Pamun の事後アンケートに組み込む
3. 回答後に `tracka_ingest.js` で取り込む

詳細は [Pamun取込 手順書の Track A 節](phase3-slice2-pamun-ingest-runbook.md)。

---

## この導線が測れないもの

勉強会フォームの【購入意向】【推奨意向】は**商品全体に対する1問**で、ワード単位ではない。
したがって**ワードごとの購買意向共感率はこのフォームからは出ない**。それは Track A の担当。

勉強会が担うのは候補ワードの発掘と、`言及数`・`ブランド未認知` の2つのシグナル
（スコアエンジンが勉強会シグナルから使うのはこの2つだけ）。
