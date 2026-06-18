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

## 6. 重要な前提・注意

- 1〜5の正規化は**v0.1のヒューリスティック**（プール内5分位）。最終点は編集判断で上書き可、次サイクルで較正。
- 売上は構造的に非公開 → ランキング順位＋自己申告で代理。
- Google News経路は社内ネットワークで要検証（サンドボックス外）。
- Apps ScriptのNotionトークンは Script Properties 管理（コード直書きなし）。
- Phase 2: 各取得をBigQueryに集約しSQLで自動算出（ARCHITECTURE.md準拠）。
