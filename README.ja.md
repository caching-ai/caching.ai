[English](README.md) | [한국어](README.ko.md) | **日本語** | [中文](README.zh.md) | [Español](README.es.md)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/logo-dark.png">
    <img src="apps/web/public/logo.png" alt="caching.ai" width="360">
  </picture>
</p>

<p align="center">
  <b>AI プロンプトキャッシュを温かく保ち、請求額を低く抑えるプロキシ。</b><br/>
  Anthropic・OpenAI・Gemini・Grok にドロップインで対応。ベース URL を差し替えるだけです。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
  <a href="https://www.npmjs.com/package/cache-guard"><img src="https://img.shields.io/npm/v/cache-guard?label=cache-guard" alt="npm" /></a>
  <a href="https://caching.ai"><img src="https://img.shields.io/badge/cloud-caching.ai-00d722" alt="Cloud" /></a>
</p>

---

モデルプロバイダーは、繰り返されるプロンプトのプレフィックスをすでに約 90% 割引しています——ただし、キャッシュが温かい間だけです。実際のトラフィックでは、キャッシュはひっそりと期限切れになったり（アイドル約 5 分）、壊れたり（プレフィックス内の不安定な 1 バイト）して、再び全額を支払うことになります。Caching.ai はアプリとプロバイダーの間に入り、この割引を確実に実現させます。

- **キャッシュ分析** — 実際のヒット率、節約できた金額、そして誰も見せてくれない数字：キャッシュされるべきだったのにされなかったプロンプトで無駄になった金額。保存するのはトークン数のみで、プロンプト／レスポンスの本文は一切保存しません。
- **キャッシュガード** — `cache_control` の自動注入（Anthropic）、GPT-5.6+ のキャッシュ復元（5.6 世代はブレークポイントでのみマッチするため、素朴な共有プレフィックスではリクエスト間ヒットが 0% になります——明示的な `prompt_cache_breakpoint` と安定した `prompt_cache_key` を注入し、実測 0% → 97.8% のプレフィックスヒット、定常トラフィック — [BENCHMARK.ja.md](BENCHMARK.ja.md) の S6 セル）、そしてキャッシュブレーカーの検出と推定される根本原因の提示（タイムスタンプ、ランダム ID、ツールの並べ替え）。
- **キャッシュウォーマー（keep-alive）** *（キーごとのオプトイン、Anthropic のみ — 設計上の判断です）* — 1 トークンの ping で、再利用が経済的である間だけ（最大 62.5 分）プレフィックスを温め直します。日次予算はユーザーが管理できます。他のプロバイダーはアップストリーム側で自前でキャッシュを保持するため（実測済み — [BENCHMARK.ja.md](BENCHMARK.ja.md)）、ping が元を取れない場所ではプロキシは予算を一切使いません。長時間のホールドは、ping の連続送信ではなく 1 回の 1h-TTL 書き込みとして処理されます。席を外すときは、チャットで `"keep my cache warm for 2 hours"` と送るだけ——プロキシ自身が応答し、ウォーミングを保持します（下記参照）。
- **プレフィックスオプティマイザー** — リクエスト間でプロンプトのどの部分が変化しているかを計測し、修正方法を提示します。
- **サブテナント** — 1 つの `ck_` キーで多数のエンド顧客にサービスを提供していますか？ 各リクエストに `X-Cache-Tenant`（さらにエンドユーザーごとに `X-Cache-Warm-Slot`）を付けるだけで、テナントごとのキャッシュポリシー、使用量・節約額の帰属、ウォームスロットが得られます — 管理は `/admin/v1/tenants` でそのキー自体を使ってプログラム的に行えます。顧客ごとにキーを発行する必要はありません。

<p align="center">
  <img src=".github/assets/hero-cache-warm.png" alt="A robot keeping the cache flame warm while the cold one costs 10x" width="640">
</p>

**約束ではなく、実測です。** caching.ai をプロバイダー直接呼び出しと比較してベンチマークしました——3 アーム、6 種のトラフィックパターン、約 1 万件の実際に課金された API コール。生ログはコミット済みで、ご自身のキーで再実行できます。詳細は [BENCHMARK.ja.md](BENCHMARK.ja.md) をご覧ください。

あらゆる SDK で動作します——統合はベース URL の差し替えだけです。

```bash
# before
ANTHROPIC_BASE_URL=https://api.anthropic.com
# after
ANTHROPIC_BASE_URL=https://your-proxy-host   # or https://proxy.caching.ai
ANTHROPIC_API_KEY=ck_your_caching_ai_key
```

## ウォームホールドを、わかりやすく

任意の SDK から短いチャットメッセージを 1 通送るだけ——プロキシがそれをインターセプトして即座に応答し、アップストリームには一切転送しないため、トークンコストはゼロです。

```
"keep my cache warm for 2 hours"
"캐시 2시간 지켜줘" · "キャッシュを2時間保温して"
"mantén mi caché caliente 2 horas" · "帮我保温缓存 2 小时"
cai:hold 45m          # explicit command — works anywhere, any language

→ 🔥 Warming held for 2 hours. (answered at the proxy, $0)
```

デフォルトは 2 時間で、5 分〜12 時間の範囲に制限されます。すべてのパス——Anthropic Messages、OpenAI chat & responses（Codex）、Gemini、Grok——で動作し、質問した言語（ko/en/ja/es/zh）で応答します。メッセージは短く（60 文字以下）、明確にキャッシュに関する内容である必要があります。実際のプロンプトに見えるものは、そのまま通過します。キープアライブがキーで有効になっている必要があり、日次ウォーミング予算も引き続き適用されます。ホールド中は、コンソールに「Warm hold active · until HH:MM」バッジが表示されます。

### Claude Code なら完全自動 ([`claude-plugin/`](claude-plugin/))

Claude Code を API キーで使っているなら、**Cache Keeper** プラグインが毎ターン
の終わりにウォームホールドを更新します — 昼休みから戻ってもキャッシュは冷えて
いません。Claude Code 内で一度だけインストール:

```
/plugin marketplace add caching-ai/caching.ai
/plugin install cache@caching-ai
```

`/cache:setup` は新しいマシンの接続（設定のバックアップ + 検証呼び出し）を行い、
`/cache:hold 8h` は長めの離席を、`/cache:status` は現在の状態を表示します。
settings の `env` ブロックで `CACHING_AUTO_HOLD`（"4h"、最大 12 時間、"off"）を
設定すると自動ホールドの長さを変更でき、セルフホストは `CACHING_PROXY_URL` で
自分のプロキシを指定します。

## クラウド vs. セルフホスト

| | **Caching.ai Cloud** | **セルフホスト** |
|---|---|---|
| 運用 | ゼロ — プロキシ、ウォーミングデーモン、ダッシュボードを 24 時間 365 日、当社が運用します | ご自身で運用 |
| 料金 | *検証済み純節約額*の 20%、月額 $5 未満は免除 | 永久無料 |
| 課金インフラ | カード登録による後払い、節約額の検証込み | 不要 |
| はじめ方 | [caching.ai](https://caching.ai) — 2 分 | 下記の `docker compose up` |

節約がゼロなら、支払いもゼロ——それが料金モデルのすべてです。

## ホステッドクラウドが加えるもの

セルフホストでもプロキシの全機能が使えます。クラウドは、自分で運用するのが面倒な部分を上乗せします:

- **Auto-Tune** *(クラウド専用 — [`ee/`](ee/README.md))*: キーごとの実際の呼び出しリズムを学習し、トラフィックが変わっても最も安いキャッシュ設定を選び直し続けます。オートパイロットの上の「設定して忘れる」レイヤーです。
- **検証済み節約額ベースの課金**: 実際に節約できた額（保温ピング費用を差し引いた純額）を計測し、その20%だけをいただきます。月$5未満は無料。節約ゼロなら請求もゼロです。
- **レポートが最初から届く**: 週次節約レポートと日次予算アラートが設定なしで届きます（セルフホストはResendキーが必要）。
- **運用ゼロ**: プロキシ群・保温デーモン・Postgres・マイグレーション・アップグレードはすべて当社の担当です。
- **登録から節約まで2分**: [caching.ai](https://caching.ai) → プロバイダーキー登録 → base URLをひとつ差し替え。

## セルフホスティング

要件：Docker + Docker Compose。

```bash
git clone https://github.com/caching-ai/caching.ai.git
cd caching.ai
cp .env.example .env          # then fill in the two secrets:
# ENCRYPTION_KEY=$(openssl rand -hex 32)
# SESSION_SECRET=$(openssl rand -hex 32)
docker compose up -d --build
```

- Web コンソール → http://localhost:3000
- プロキシ → http://localhost:8787（liveness: `/healthz`、readiness: `/readyz` — データベースをチェックします）

コンソールでサインアップし、プロバイダーの API キーを登録し（AES-256-GCM で保存時暗号化）、`ck_` キーを作成して、SDK のベース URL をプロキシに向けてください。Postgres のマイグレーションはプロキシ起動時に自動的に実行されます。

オプションの統合（すべてデフォルトでオフ）：Google OAuth（`GOOGLE_CLIENT_ID/SECRET`）、トランザクションメール（`RESEND_API_KEY` — サインアップ認証、週次節約レポート、キープアライブ予算アラートを有効化し、いずれもワンクリックの RFC 8058 配信停止に対応）、Prometheus メトリクス（`METRICS_TOKEN` → `GET /metrics` に `authorization: Bearer <token>`：リクエスト／トークン／コスト／節約カウンター、キープアライブ ping コスト、レイテンシヒストグラム、DB プールゲージ）、生ログ保持期間の調整（`LOG_RETENTION_DAYS`、デフォルト 100 — 完了した日はプルーニング前に `request_logs_daily` にロールアップされます）、アップストリーム URL のオーバーライド（`UPSTREAM_URL`、`OPENAI_UPSTREAM_URL`、`GEMINI_UPSTREAM_URL`、`GROK_UPSTREAM_URL`）、後払い課金パイプライン（`BILLING_LIVE=1` + Stripe/Toss キー — セルフホストではまず必要ないでしょう）。すべての設定項目はコメント付きで [.env.example](.env.example) に記載されています。

## アーキテクチャ

pnpm モノレポ：

```
apps/proxy          Hono proxy — key exchange, usage metering from the live
                    stream (SSE passthrough, no buffering), cache_control
                    injection, breaker detection, keep-alive scheduler,
                    savings/billing sweeps
apps/web            Next.js console — dashboard, key management, billing
packages/shared     pricing tables, crypto, db + forward-only migrations
packages/cache-guard-cli   `npx cache-guard` — scan a repo for cache breakers
ee/                 source-visible, commercially licensed (see ee/README.md) —
                    adaptive cache tuning that powers the cloud's Auto-Tune
```

### CI でキャッシュブレーカーを捕まえる

[`cache-guard`](https://www.npmjs.com/package/cache-guard) は、Anthropic Messages リクエストフィクスチャのキャッシュ可能なプレフィックス（tools、system、最初のメッセージ）をハッシュ化する小さな npm CLI です——プロンプトのプレフィックスをうっかり不安定にした PR は、請求額を静かに 10 倍にする代わりに、CI で失敗するようになります。

```bash
npx cache-guard snapshot fixtures/*.json   # write the .cacheguard.json baseline
npx cache-guard check fixtures/*.json      # exit 1 if any prefix hash changed
```

プライバシーモデル：プロキシが保存するのは、トークン数、モデル名、レイテンシ、ステータスコード、プレフィックスブロックの SHA-256 ハッシュのみで、プロンプトやレスポンスの本文は決して保存しません。唯一の例外はオプトインのキャッシュウォーマーで、最後のプロンプトプレフィックスを暗号化（AES-256-GCM）して保存します。それを再送することがキャッシュを温かく保つ仕組みだからです。データベースはあなたのものです——これらすべてをコードで検証できます。

## 開発

```bash
pnpm install
cd apps/proxy && pnpm test    # needs local Postgres 16
cd apps/web && pnpm dev
```

[CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。セキュリティ報告：[SECURITY.md](SECURITY.md)。

## ライセンス

[Apache-2.0](LICENSE) © 2026 AI3 Inc. — このリポジトリのすべてが対象ですが、`ee/` ディレクトリは例外で、商用ライセンスの下でソース公開されています（[ee/README.md](ee/README.md) 参照）。セルフホストビルドは `ee/` なしで完全に動作します。「caching.ai」と炎のロゴは AI3 Inc. の商標です——[NOTICE](NOTICE) をご覧ください。
