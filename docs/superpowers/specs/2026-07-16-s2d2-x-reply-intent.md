# S2d-2: X リプライ転換質診断（Apify＋Claude）設計書

- 日付: 2026-07-16
- ステータス: 設計確定（実装前）
- 親プロジェクト: CG インフルエンサープラットフォーム再構成（S1/S2a/S2b/S2c/S2d-1完了／本書=S2d-2／S3未着手）

## 背景

S2d-1で Astream X CSV からX候補を候補DB（インフルエンサーDB）に登録できるようになった。
ただしAstreamのX CSVには**転換質（購買意向）が無い**ため、S2d-1で登録したX候補の `転換質%` は空のままである。

本書（S2d-2）は、Apifyで**Xのリプライを直接取得**し、Claude（`claude-sonnet-4-6`）で購買意向を判定して
`転換質%` を埋める。既存の Apify IG転換質スキャン（`scripts/apify/fetch_instagram.js` ＋ `POST /api/cockpit/instagram`）と同系譜。

### なぜキーワード方式をそのまま移植しないか（本設計の核心）

IGの `fetch_instagram.js` は `PURCHASE_SIGNALS`（「買った」「欲しい」「気になる」等15語）のヒット率で転換質を出す。
これをXにそのまま移植すると**確実に壊れる**。Xは**プレゼント企画・フォロー&RT懸賞**が大量にあり、
リプライが「欲しい！」で埋まるため、**懸賞アカウントほど転換質が高く出る**という逆転が起きる。
これが「Xは転換質が構造的に取りにくい」の正体である。

したがって精度の投資先は「スコア式の微調整」ではなく、以下の2点とする：

1. **懸賞・企画投稿を決定的（コード）で除外する** — 最大のバイアス源を安く確実に潰す
2. **残った本物のリプライだけをClaudeが判定する** — 「欲しい（懸賞目当て）」と「欲しい（本気）」の判別という、本当に賢さが要る所にだけLLMを使う

## 用途と較正スタンス（重要）

- 本指標は **X候補どうしの相対比較**に使う。**YouTube／IGの転換質と同じ土俵で並べない。**
- 理由：YouTubeの転換質（コメント購買意向率）とIGのプロキシ点は互いに較正されておらず、
  `ig_conversion_proxy.py` 自身が「v0.1の設計（仮説）。実売結果が未取得のため未検証」と明記している。
  未検証のX指標を足して媒体横断で並べると、**精度が上がったように見えて偽の精度**になる。
- 本指標も **v0.1仮説**として扱い、実売が貯まった時点で較正する（`販売結果の組込み手順_過学習防止.md` の原則に従う）。
- UIには「v0.1・未較正／X内比較用」と明示する。

## ゴール / 非ゴール

**ゴール**
1. 懸賞・PR・bot判定の純粋関数 `lib/x-reply-filter.js`（単体テスト対象）
2. Claude判定プロンプトビルダー `lib/x-intent-prompt.js`（単体テスト対象・`analyze-prompt.js` と同型）
3. Apify取得＋フィルタのスクリプト `scripts/apify/fetch_x_replies.js`
4. `POST /api/cockpit/x-intent`（**1アカウント/リクエスト**）
5. 候補DBタブに「🐦 X転換質診断」カード：媒体=XをリストしチェックON→診断→結果＋根拠リプライ→`転換質%` を書き戻し

**非ゴール**
- 媒体横断の較正・正規化（実売が貯まってから別途）
- Xの客層・実在率の取得（構造的に不可。S2d-1同様、女性%/中核年齢/実在率%は空のまま）
- YouTube/IGの転換質ロジック変更（本書はXのみ）
- 診断ログ（`診断ログ`シート）への記録（S2cの既知の制限に触れるため対象外）

## アーキテクチャ

```
候補DB(媒体=X) → 選択(最大20) → [フロントが1件ずつループ]
   → POST /api/cockpit/x-intent {account}
        → scripts/apify/fetch_x_replies.js（Apify取得＋決定的フィルタ）
        → lib/x-intent-prompt でプロンプト生成 → Claude判定(JSON)
        → 転換質% を算出して返す
   → 画面に結果＋根拠リプライ表示 → 「DBに反映」で registerCand({account, media:'X', conversion})
```

### なぜ「1アカウント/リクエスト」なのか（制約からの決定）

**Cloud Runのリクエストタイムアウトは300秒**（`cg-cockpit` 実測値・メモリ512Mi）。
20アカウントを1リクエストで処理すると（Apify取得＋Claude判定 × 20 ≒ 20〜30分）**確実にタイムアウトする**。

既存のIG診断が `Instagram 診断（Apify）— 1ユーザーずつ（フロントで複数ループ）` という作りなのは、この制約への正しい答えである。
本書もそれに倣う。副次的な利点として、①結果が1件ずつ出る（進捗が見える）②1件の失敗が全体を巻き込まない。

1アカウントあたりの想定：Apify取得 20〜60秒＋Claude判定 10〜30秒 ≒ **1〜1.5分**（300秒に十分収まる）。
20人を通すと**実時間20〜30分**かかる。UIは進捗（`3/20 完了`）を表示し、途中経過を随時描画する。

## Apifyアクター

**`apidojo~twitter-profile-scraper`**（Twitter Profile Scraper: Get Profile Tweets + Their Replies）を使う。
IGの2アクター連鎖（投稿→コメント）と違い、**1アクターでプロフィールのツイート＋リプライを取得できる**。

**入力（本書で使うもの）**

| フィールド | 値 | 意図 |
|---|---|---|
| `twitterHandles` | `[<account>]` | 候補DBのアカウント名をそのまま渡す（1件） |
| `getReplies` | `true` | リプライを取得 |
| `start` | 90日前の日付（`YYYY-MM-DD`） | 鮮度の確保 |
| `minReplyCount` | `5` | 反応の薄い投稿のリプライを取りに行かない（コスト制御） |
| `maxItems` | `300` | 1アカウントあたりの上限（コストの硬い天井） |

**料金**（2026-07時点の調査値）：プロフィールクエリ $0.016（先頭40ツイート無料）／リプライクエリ $0.016（先頭36リプライ無料）／超過 $0.0004 per item。
→ **1アカウント ≒ $0.1前後、20人で $2〜3 程度**。初回実行時に実測して見直す。

**出力（本書で使うもの）**：ツイート本文・URL・リプライ本文・リプライ投稿者名・エンゲージメント。

## サンプリング方針

- 直近90日 / 1アカウントあたり **最大5投稿 × 投稿あたり最大50リプライ＝最大250リプライ**（`maxItems:300` が硬い上限）
- 対象投稿の選び方：懸賞投稿を除外 → リプライ数の多い順に上位5件

## 決定的フィルタ（`lib/x-reply-filter.js`・純粋関数）

### 設計原則：除外は「やや過剰」でよい

**誤差の非対称性**を前提にする。懸賞投稿を取りこぼすと「欲しい」の洪水が入り**指標が体系的に歪む（バイアス）**。
一方、通常投稿を誤って除外してもサンプルが減るだけで**バイアスは生まない**。したがって迷ったら除外する。

### 関数

| 関数 | 責務 |
|---|---|
| `isGiveawayPost(text)` | 懸賞・企画マーカーを含むか。マーカー：`プレゼント` `懸賞` `抽選` `応募` `当たる` `当選` `キャンペーン` `フォロー&RT` `フォロー＆RT` `フォロー&リポスト` `リポストで` `RTで` `giveaway`（全て小文字化して部分一致） |
| `isPRPost(post)` | PR投稿か。マーカーはIGの `PR_MARKERS` を踏襲：`#pr` `#ad` `#提供` `#タイアップ` `提供:` `提供：` `タイアップ` `案件` `sponsored` `アンバサダー` |
| `selectPosts(posts, {maxPosts})` | 懸賞投稿を除外し、リプライ数の多い順に `maxPosts` 件返す |
| `cleanReplies(replies, {maxPerPost})` | 定型・bot・懸賞目当てリプライを除去し重複を落とす。除去対象：`フォローしました` `相互フォロー` `参加します` `応募します` `当たりますように`、本文がURLのみ、絵文字のみ、空文字。投稿者本人の自己リプ（連投）も除外 |

`isPRPost` は除外には使わず、**結果に「PR投稿を含む/含まない」を表示するため**に使う（IGの `--pr-only` に相当する絞り込みは本書では非ゴール）。

## Claude判定（`lib/x-intent-prompt.js`＋ルート）

`buildXIntentPrompt({ account, replies })` → `{ system, user }` を返す（`buildAnalyzePrompt` と同型）。

**ルーブリック**：各リプライを次の5分類のいずれかに割り当てる。

| ラベル | 定義 | 例 |
|---|---|---|
| `purchased` 購入済 | 既に買った・使っている | 「買いました」「届いた」「リピしてる」 |
| `willBuy` 購入予定 | 買う意思が明確 | 「絶対買う」「ポチる」「注文してくる」 |
| `want` 欲しい | 欲しいが購入意思は未確定 | 「欲しい」「気になる」「どこで買えますか」 |
| `interest` 興味 | 商品でなく投稿者・投稿への反応 | 「かわいい」「参考になる」 |
| `unrelated` 無関係 | 雑談・挨拶・スパム・**懸賞目当ての「欲しい」** | 「おはよう」「当選しますように」 |

**懸賞目当ての「欲しい」は `unrelated` に落とす**ことをプロンプトで明示する（投稿単位の除外を擦り抜けた分の保険）。

**出力形式**：Claudeには次のJSONのみを返させる（`max_tokens: 4096`）。

```json
{
  "total": 判定したリプライ数,
  "counts": { "purchased": 0, "willBuy": 0, "want": 0, "interest": 0, "unrelated": 0 },
  "evidence": { "purchased": ["..."], "willBuy": ["..."], "want": ["..."] },
  "note": "気になった点（任意・80字以内）"
}
```

`evidence` は各ラベル最大3件。人間が較正するための根拠として画面に出す。

## 転換質% の定義

```
転換質% = (purchased + willBuy + want) ÷ total × 100   … 小数第1位まで
```

- 分子に `want`（欲しい）を含める。理由：IGの `PURCHASE_SIGNALS` が「欲しい」「気になる」を含む**同じ幅**であり、
  候補DBの既存しきい値（`15%以上=緑 / 5%以上=橙`、`applyIdbFilter` の描画）がそのまま機能するため。
  **形式を揃えるだけで、較正済みという意味ではない**（前掲の較正スタンス参照）。
- `interest` と `unrelated` は分子に入れない。
- **重み付け合成は行わない**。未検証の任意定数を入れることになり、過学習防止の原則と衝突するため。
- `counts` の内訳は全て返す。後から分子の定義を変えて再集計できるようにするため。

## コンポーネント / ファイル

- **`lib/x-reply-filter.js`（新規）** — 上記4関数。外部依存なし。`module.exports = { isGiveawayPost, isPRPost, selectPosts, cleanReplies, GIVEAWAY_MARKERS, PR_MARKERS }`
- **`lib/x-intent-prompt.js`（新規）** — `buildXIntentPrompt({account, replies})` → `{system, user}`。`module.exports = { buildXIntentPrompt }`
- **`scripts/apify/fetch_x_replies.js`（新規）** — Apify I/O。`node scripts/apify/fetch_x_replies.js <handle> --json` で
  `@@JSON@@{"ok":true,"account":"...","posts":N,"giveawayExcluded":N,"hasPRPost":bool,"replies":[...],"note":"..."}` を出力。
  `lib/x-reply-filter` を使う。`APIFY_TOKEN` 未設定なら非ゼロ終了＋stderr（既存 `fetch_instagram.js` と同様）
- **`cockpit-server.js`（既存・修正）**
  - 新ヘルパ `runScriptJson(scriptRel, args)` → `Promise<data>`（既存 `runScript`/`runScriptThen`/`runPythonCsv` と同型の追加）。
    **理由**：既存 `runScriptThen` は `after()` の例外を握り潰して「実行に失敗しました」に丸めるため、
    Apify段とClaude段のエラーを区別できない。本書はエラーの明示性を要件にしているのでPromise版を足す。
  - `POST /api/cockpit/x-intent`（requireAuth）：`APIFY_TOKEN`・`ANTHROPIC_API_KEY` をガード →
    `runScriptJson` → `buildXIntentPrompt` → Anthropic SDK（`claude-sonnet-4-6`・`/api/cockpit/analyze` と同じ呼び方）→
    JSONパース → 転換質%算出 → 返す
- **`public/cg-cockpit.html`（既存・修正）** — 候補DBタブ（`idb`）に「🐦 X転換質診断」カードを追加。
  `IDB_ALL` から `media==='X'` を抽出しチェックボックス付きで一覧 → 「選択した候補を診断」→
  1件ずつ `x-intent` を呼びながら進捗と結果を随時描画 → 各行「DBに反映」で `registerCand({account, media:'X', conversion})`

`registerCand` の書き戻しは既存 `mergeInfluencer` が**空でない値だけ上書き**するため、
`conversion` だけ送ればS2d-1が入れたフォロワー・適性メモ・URLは保持される（確認済み）。

## データフロー

候補DBタブを開く → X候補が一覧（現在の転換質%も表示）→ 診断したい候補にチェック（最大20）→
「選択した候補を診断」→ 1件ずつ：Apify取得 → 懸賞投稿を除外 → リプライを整形 → Claude判定 →
転換質%＋内訳＋根拠リプライを表示 → 「DBに反映」→ 候補DBの `転換質%` が埋まる

## エラーハンドリング

| 状況 | 挙動 |
|---|---|
| `APIFY_TOKEN` 未設定 | 400 `APIFY_TOKEN未設定（Cloud Runの環境変数に追加してください）`（既存IG診断と同文言） |
| `ANTHROPIC_API_KEY` 未設定 | 400 `ANTHROPIC_API_KEY未設定（Cloud Runの環境変数に追加してください）`（既存analyzeと同文言） |
| 選択0件 / 20件超 | フロントで弾く（`診断する候補を選択してください` / `一度に診断できるのは20件までです`） |
| 鍵垢・凍結・存在しない | そのアカウントのみ `取得不可` と理由を表示。**ループは継続**（他の候補を巻き込まない） |
| **懸賞投稿しか無く対象ゼロ** | **`対象投稿なし（懸賞のみ）` と明示し、転換質%は算出しない。** 0%と混同させない（0%＝「反応はあるが買う気ゼロ」という別の意味になるため） |
| **判定対象リプライ < 20件** | 転換質%は出すが **`サンプル不足` の警告を併記**。DBへの反映も可能だがUIで警告を出す |
| Claudeの出力がJSONでない | 500 `判定結果の解析に失敗しました`（Apify段の失敗と区別する） |
| Apify段の失敗 | 500 `リプライ取得に失敗しました: <理由先頭400字>` |
| 認証 | requireAuth（401/403） |

## テスト方針

- **`test/x-reply-filter.test.js`（新規・node:test）** — 純粋関数なので厚くテストする（精度の要）
  - `isGiveawayPost`: 各マーカーを含む文で `true`／通常のコスメ投稿で `false`／大文字小文字混在（`RTで`/`rtで`）
  - `isPRPost`: `#PR`・`案件`・`提供：` で `true`／`prefecture` のような語で誤検出しない
  - `selectPosts`: 懸賞投稿が除外される／リプライ数の多い順／`maxPosts` で打ち切る／全部懸賞なら空配列
  - `cleanReplies`: 定型（`フォローしました` 等）除去／URLのみ・絵文字のみ除去／重複除去／`maxPerPost` で打ち切る
- **`test/x-intent-prompt.test.js`（新規・node:test）** — `analyze-prompt.test.js` と同型
  - `buildXIntentPrompt` が `{system,user}` を返す／リプライが本文に含まれる／5分類とJSON形式の指示が含まれる／リプライ0件で例外
- **`scripts/apify/fetch_x_replies.js`／Claude実呼び出しは手動検証**（外部API依存。既存Astream/Apifyスクリプトと同じ扱い）
  - 検証：実在するXコスメアカウント1件で `node scripts/apify/fetch_x_replies.js <handle> --json` を実行し、
    懸賞投稿が除外されているか・リプライが取れているかを目視
  - 検証：コックピットで1件だけ診断し、転換質%・内訳・根拠リプライが妥当か目視（**懸賞垢を1件混ぜて、転換質が不当に高く出ないことを確認する**）
- 既存57件のnode:testを壊さないこと

## デプロイ / 設定手順（ユーザー作業）

1. **`APIFY_TOKEN` を Cloud Run に設定（未設定のため必須。これが無いと動かない）**
   ```
   gcloud run services update cg-cockpit --region asia-northeast1 \
     --update-env-vars APIFY_TOKEN=<Apifyのトークン>
   ```
   （https://apify.com → Settings → Integrations → API token。無料枠は毎月$5クレジット）
2. Apifyで `apidojo/twitter-profile-scraper` が利用可能なこと（従量課金）を確認
3. コックピット再デプロイ（GAS不要・新Sheetsタブなし）
4. 最新 `public/cg-cockpit.html` を Xserver に再アップロード

## 未確定事項（実装時／初回実行時に確定）

- **Apifyアクターの実レスポンス形状**：`twitterHandles`＋`getReplies` 時に、リプライが親ツイートとどう紐づくか（`conversationId` 等）は
  実レスポンスを見て確定する。最初の1回は生JSONをダンプして構造を確認してから正規化を書く
- **実コスト**：$0.1/アカウントは調査値。初回実行後にApifyのコンソールで実測して見直す
- **20人の実時間**：1〜1.5分/件 × 20 ≒ 20〜30分の想定。実測が大きく超えるなら、フロントの同時実行数を2〜3に上げることを検討（本書では逐次）
- **懸賞マーカーの精度**：初回の実データで誤検出／取りこぼしを確認し、マーカーを追加する（純粋関数＋テストなので安全に足せる）
