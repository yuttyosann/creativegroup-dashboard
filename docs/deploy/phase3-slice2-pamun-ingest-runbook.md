# pamun_ingest 初回実行 手順書（Phase3 スライス2）

対象: `scripts/kizuki/pamun_ingest.js`（Track B＝既存Pamunレポートの LLM 分類取込）
仕様: [spec](../superpowers/specs/2026-07-16-kizuki-word-cycle-phase3-slice2-pamun-ingest.md)

コードは完成・テスト済み。ここは「実データで一度も動かしていない」状態を解消するための手順。

---

## 0. まず診断を回す

```bash
cd /Users/yuttyo/claude/creativegroup-dashboard
node .worktrees/kizuki-word-cycle/scripts/kizuki/pamun_preflight.js
```

読み取り専用。環境変数・Google認証・タブの有無・**ヘッダー行の位置**・候補ワード・アンケート回答数までを実物を見て検査し、
NG ごとに具体的な直し方を出す。以下の Step は preflight が指摘した項目だけやればよい。
全部 ✅ になったら dry-run へ進める（終了コード 0）。

---

## 1. Claude が代行できない作業

| 作業 | 理由 |
|---|---|
| `.env` の作成・編集 | サンドボックスの deny list に入っており読み書きできない |
| Google 認証（ADC）の再ログイン | ブラウザ認証が必要 |
| スプレッドシート上の編集（タブ作成・列追加・xlsx 取込） | 本番シートへの書き込みのため、実行するなら都度確認が要る |

それ以外（診断・dry-run・本実行・recalc_job）は依頼されれば実行できる。

---

## Step 1. `.env`

`dotenv` は **実行時のカレントディレクトリ**基準で `.env` を解決する。
一方 `require` はスクリプト自身の位置基準なので、**本体リポジトリをカレントにして
worktree のスクリプトを実行すれば、`.env` を worktree に複製しなくてよい**。

```bash
cd /Users/yuttyo/claude/creativegroup-dashboard
node .worktrees/kizuki-word-cycle/scripts/kizuki/pamun_preflight.js
```

本体の `.env` には `ANTHROPIC_API_KEY` が既にある。**追記が要るのは `SHEET_ID` の1行だけ**：

```
SHEET_ID=1VxAOesBm_gi_jlSlq39FDtTMZNYOQcBm3J53gw3_g3o
```

この値はコックピット本番（Cloud Run `cg-cockpit` / asia-northeast1）の環境変数と同じもの。
次回以降うろ覚えになったら以下で引ける：

```bash
gcloud run services describe cg-cockpit --region=asia-northeast1 \
  --format="value(spec.template.spec.containers[0].env)" | tr ';' '\n' | grep SHEET_ID
```

`ANTHROPIC_API_KEY` は dry-run では不要、本実行で必須。

## Step 2. Google 認証にスプレッドシートのスコープを付ける

**現状の ADC は spreadsheets スコープを持っていない**（preflight で `Insufficient Permission` を確認済み）。
`lib/sheets.js` は ADC を使うので、これを直さないと読み取りすらできない。

```bash
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/cloud-platform
```

サービスアカウント鍵を使うなら `GOOGLE_APPLICATION_CREDENTIALS` に鍵のパスを設定し、
そのサービスアカウントにスプレッドシートの閲覧＋編集権限を共有する。

## Step 3. モニターシグナルに 3 列を追記

ヘッダー行の F/G/H に `source` / `campaign_id` / `confidence` を**手で追記**する。

> ⚠️ **`buildKizukiLedger()` は実行しないこと。** この関数は
> `KZ_SHEETS` のタブを **一度削除してから作り直す**（[CG_気づきワード台帳.gs:19](../../CG_気づきワード台帳.gs)）。
> 既存の台帳・シグナルが全部消える。
> `addKizukiLedger()` は安全だが「無いタブを足す」だけなので、既存タブには 3 列を追加しない。
> つまり **GAS 再実行では解決しない**。手で足すのが正しい。

既存の手入力行は `source` 空欄のままでよい（`DEFAULT_REVIEW_SOURCE` で `manual` 扱い）。

## Step 4. `Pamun取込マッピング` タブを作る

新規タブ名 `Pamun取込マッピング`、**1 行目にヘッダー、2 行目からデータ**。

| campaign_id | report_name | case_id | n |
|---|---|---|---|
| 施策の識別子（upsertキーの一部） | レポートのタブ名接頭辞 | 台帳の case 列と一致させる | 全回答者数（空なら回答数を使用） |

> ⚠️ **他のタブのようなタイトル帯を付けないこと。**
> `lib/kizuki/*` と `scripts/kizuki/*` はすべて `rows.slice(1)` ＝「1 行目がヘッダー」を前提にしている。
> 一方 GAS が生成するシートは 2 行目がタイトル帯・3 行目がヘッダーなので、その体裁を真似ると
> ヘッダー行が施策データとして読まれ、存在しないタブを読みに行って実行全体が落ちる。
> preflight はこのズレを検出する。

## Step 5. 施策レポートを取り込む

施策レポート（xlsx）を同じスプレッドシートに取り込み、アンケート詳細のタブ名を
`<report_name>《事後アンケート》詳細` にする（`report_name` は Step 4 で書いた値）。

列順は A から: 年代 / 満足度 / 良かった点 / 改善点 / 容器希望 / お気に入り。
分類の主材料は「良かった点」、満足度・お気に入り・改善点は文脈として使われる。

---

## Step 6. dry-run

```bash
node scripts/kizuki/pamun_ingest.js --dry-run
```

> **dry-run は必ず「モニターシグナル生成 0行」と出る。これは異常ではない。**
> LLM 分類をスキップして全回答者を空配列にするので、集計結果が必ず空になる。
> dry-run で見るべきは **「回答 N 人 / n=N」が期待どおりか**と、
> 「候補ワードが台帳にありません」の警告が出ていないか。

## Step 7. 本実行

```bash
node scripts/kizuki/pamun_ingest.js --campaign <campaign_id>
```

まず 1 施策だけ `--campaign` で指定して実行し、モニターシグナルの書き込み結果を目視確認する。
`--campaign` を省くとマッピング上の全施策に LLM 分類がかかる。

upsert キーは `(word_id, campaign_id, source)`。同じ施策を再実行しても行は増えず更新される。
`source=trackB` 以外（手入力 `manual` / `trackA`）の行は触らない。

## Step 8. スコア反映

```bash
node scripts/kizuki/recalc_job.js
```

`pamun_ingest` は台帳スコアを再計算しない。日次の `recalc_job` が次回拾うが、すぐ反映したいならこれを実行する。

> `pamun_ingest` を `recalc_job` に組み込まないこと（設計判断）。
> 日次ジョブに入れると同じレポートに毎日 LLM 分類を掛けることになる。

---

## 確認しておくべき数字

初回実行後、モニターシグナルの `trackB` 行を見て:

- **購買意向共感率 = 意向あり人数 ÷ 全回答者 n**（言及しなかった人も分母に残る普及率）。
  「件数は多いが共感率が低い」ワードが出てきたら、それが虚栄ワード（パケが可愛い型）を炙り出せている証拠。
- **`confidence` が 0 の行**は LLM が最も自信のない分類。捨てずに残してあるので、優先的に目視レビューする。
