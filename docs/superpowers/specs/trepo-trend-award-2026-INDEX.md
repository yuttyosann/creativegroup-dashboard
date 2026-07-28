# Trepoトレンド大賞2026 — 全体索引（1枚まとめ）

> この企画の設計・成果物・スクリプト・運用を1枚で俯瞰するための索引。
> 詳細は各リンク先を参照。最終更新: 2026-06-17

## 0. これは何か

Trepo編集部主催の年間アワード。**「客観データで候補を出し、編集部が得点を足す」**仕組みで、
2026年に話題になったトレンド（商品・サービス・スポット・コンテンツ）を選定・発表する。

**確定方針:** 権威性最優先 ／ 編集部リサーチ＋インバウンド ／ 実績×主観バランス（予兆型は対象外）
／ A×Cハイブリッド選出 ／ エビデンス必須・該当項目のみ正規化（実績50:編集50）

## 1. エンドツーエンドの流れ

```
[候補生成] 公開ランキング＋急上昇シグナル ─┐
[インバウンド] エントリーフォーム ──────┤→ Notion候補プールDB（Trepo編集部配下）
                                          │
[実績スコア] Trends/TikTok/YouTube/Media ─┘→ スコアカードシートで採点
                                                  ↓
        0次(形式) → 1次(スコアカード) → 2次(お試し会) → 3次(審査員) → 発表
```

## 2. 成果物（Notion / Google）

| 種別 | 名称 | 場所 / ID |
|---|---|---|
| Notion DB | Trepoトレンド大賞2026 候補プール | `3832a9c9-20f7-81ad-a21e-fee38dfd4b8c`（**Trepo編集部**配下）|
| Notion | 企画本体（社内企画メモ／リリース案／スケジュール） | `3812a9c9-20f7-80ba-9bc6-cdd2ac24241f` |
| Googleスプレッドシート | スコアカード採点シート | https://docs.google.com/spreadsheets/d/1pPpADt_84BcSwHG6NaHoVb4-ZQAZFvg3dbEPFZjQF7g/edit |
| Googleフォーム | エントリーフォーム | `scripts/trepo_award_form.gs` から生成 |

## 3. 設計・運用ドキュメント（docs/superpowers/）

| ドキュメント | 用途 |
|---|---|
| [選出ロジック設計書](specs/2026-06-16-trepo-trend-award-selection-design.md) | 賞の定義・選出ロジック・受賞部門（確定）の根幹 |
| [オペレーション実行計画](plans/2026-06-16-trepo-trend-award-buildout.md) | 6タスクの構築計画 |
| [実績スコア調査ランブック(Phase1)](specs/trepo-award-jisseki-research-runbook.md) | 候補生成＋5シグナル取得の実務手順 |
| [エントリーフォーム項目確定版](specs/trepo-award-form-spec.md) | フォーム設問仕様 |
| [スコアカード採点シート構成](specs/trepo-award-scorecard-sheet.md) | 採点シートの設計 |
| [編集部リサーチSOP](specs/trepo-award-research-sop.md) | リサーチ手順（データファースト版はランブック参照） |
| [各審査段階チェックリスト](specs/trepo-award-review-checklists.md) | 0次〜3次の判定基準 |

## 4. スクリプト

| スクリプト | 用途 | 検証 |
|---|---|---|
| [trepo_award_form.gs](../../scripts/trepo_award_form.gs) | エントリーフォーム自動生成（Apps Script） | — |
| [trepo_award_form_to_notion.gs](../../scripts/trepo_award_form_to_notion.gs) | フォーム回答→候補プールDB自動連携（onFormSubmit） | マッピング実機検証済 |
| [trends/google_trends.py](../../scripts/trends/google_trends.py) | 検索の伸び（discover/score） | ロジック検証済 |
| [apify/fetch_tiktok.js](../../scripts/apify/fetch_tiktok.js) | TikTok話題量（SNS話題量） | ロジック検証済 |
| [apify/fetch_instagram.js](../../scripts/apify/fetch_instagram.js) | Instagram（SNS話題量・既存） | — |
| [youtube/fetch_channel.js](../../scripts/youtube/fetch_channel.js) | YouTube（インフル反響・既存） | — |
| [media/fetch_media.py](../../scripts/media/fetch_media.py) | メディア掲載（Google News＋PR TIMES） | PR TIMES実機検証済 |

## 5. 実績スコア5シグナルの取得

| シグナル | ツール | 状態 |
|---|---|---|
| SNS話題量 | TikTok(`fetch_tiktok.js`) ／ IG(`fetch_instagram.js`) ／ TikTok Creative Center(手動) | ✅ |
| 検索の伸び | `google_trends.py` ／ Googleトレンド急上昇 | ✅ |
| インフル反響 | `fetch_channel.js`（YouTube） | ✅ |
| メディア掲載 | `fetch_media.py`（News/PR TIMES） | ✅ |
| 売上実績 | 公開ランキング順位の代理＋フォーム自己申告 | ⬜ 手動 |

> ジャンル横断は **Google Trends＋TikTok Creative Center** を主軸（バックボーン）、
> @cosme/ZOZO等のジャンル別ランキングは補強（エンリッチ）という2層構造。

## 5-2. 候補の自動生成（P1 — ✅ 完了・本番稼働中）

**目的**: 今のツールは「採点」しかできない → 編集部が探さなくても候補が出る状態にした。

**パイプライン**（すべて本番の https://award.trepo.jp に載っている）:
```
シード設定DB（自動検索ON のハッシュタグ）
  ↓ scripts/apify/discover_tiktok.js   … TikTok共起タグを発掘（ノイズ多）
  ↓ scripts/ai/filter_candidates.js    … Claude(opus-4-8)で精選・カテゴリ補正・表記統一（実測33→16件）
  ↓ 既存候補・シード自体・重複を除外
「候補の提案」カードに一覧表示 → 編集部がチェック → POST /api/candidates/bulk → 候補プールDBへ登録
```

| 部品 | 役割 |
|---|---|
| `award-signal-tool/lib/discover.js` の `proposeCandidates()` | 発掘→精選→提案を返す。**Notionには一切書かない** |
| `award-signal-tool/lib/discover.js` の `adoptCandidates()` | 承認された候補だけ登録。`createCandidate()` を呼ぶ唯一の経路 |
| `POST /api/discover` | 提案ジョブを起動（`job.proposals` を返す） |
| `POST /api/candidates/bulk` | 選ばれた候補だけ登録（`{created, skipped, failed}` を返す） |

**設計思想**: 編集部は"探さず・評価する"。だから提案までは自動、**DBに入れるのは人の承認後**。
> ⚠️ 自動登録には絶対に戻さないこと。過去に90件のノイズを登録し、全アーカイブした経緯がある。

**本番実証済み（2026-07-27）**: award.trepo.jp で「候補を提案してもらう」→ **27件を提案**（発掘7分・エラーなし）。
編集部の承認待ちで採用は保留中（＝設計通り）。

> ⚠️ **ハマりどころ（2026-07-27に半日溶かした）**: Cloud Runの `apify-token` シークレットが
> デプロイ手順書のプレースホルダ `＜Apiトークン＞`（全角）のまま登録されていて、Apify認証が毎回即失敗し
> **提案0件**になっていた。症状は「discover POSTは200だがポーリングが十数秒で停止」。
> シークレット作成時は必ず実値が入ったか `gcloud secrets versions access latest --secret=apify-token | wc -c`
> で長さを確認すること（プレースホルダは全角`＜`を含む）。→ [デプロイ手順書](../setup/award-signal-tool-deploy.md)に検証ステップ追記済み。

**カバレッジ改修済み（2026-07-27）**: `--max-seeds=12` で中核カテゴリ（コスメ等）が
毎回スキップされていた問題を解消。`selectSeeds()` によるカテゴリ均等＋日次ローテーション＋
1回上限14シードで、全カテゴリが必ず提案に出るようにした（[設計書](2026-07-27-trepo-award-seed-coverage-design.md)）。

**次にやること（P2候補）**: フィードバックループの半自動化（設計書§9・方式A）／
インフル反響(YouTube)の自動化／Phase 2 のBigQuery集約。

---

## 6. 重要な前提・注意

- 1〜5の正規化は**v0.1のヒューリスティック**（プール内5分位）。最終点は編集判断で上書き可、次サイクルで較正。
- 売上は構造的に非公開 → ランキング順位＋自己申告で代理。
- Google News経路は社内ネットワークで要検証（サンドボックス外）。
- Apps ScriptのNotionトークンは Script Properties 管理（コード直書きなし）。
- Phase 2: 各取得をBigQueryに集約しSQLで自動算出（ARCHITECTURE.md準拠）。
