[English](README.md) | [한국어](README.ko.md) | **日本語** | [中文](README.zh.md) | [Español](README.es.md)

# Caching.ai 効果ベンチマーク

[caching.ai](https://caching.ai) がプロバイダー直接呼び出しと比較して実際にどれだけ節約できるか（あるいはできないか）を、6 種のトラフィックパターンと複数のモデルにわたって計測します。ご自身のキーで再現するのに必要なものはすべてこのフォルダにあります：シナリオ定義、合成フィクスチャ、ランナー、そして生の結果ログ（`results/`）。要約は [`../BENCHMARK.ja.md`](../BENCHMARK.ja.md) にあります。

## アーム

| アーム | パス | 代表するユーザー像 |
|---|---|---|
| **A** direct-naive | プロバイダー API、キャッシュヒントなし | 大多数の実ユーザー（SDK デフォルト） |
| **B** direct-tuned | プロバイダー API、最後の system ブロック + 最後のツールに `cache_control` を手動配置（プロキシが配置するのとまったく同じ位置） | Anthropic を丁寧に使いこなすチーム |
| **C** caching.ai | 同じリクエストを `proxy.caching.ai` 経由で、デフォルト設定の `ck_` キーで送信（シナリオが指定する場合はキープアライブも有効） | caching.ai ユーザー |

OpenAI、Gemini、Grok には `cache_control` の設定項目がなく（キャッシュは自動）、そこでは A ≡ B となるため、これらのモデルは 2 アームで実行します。**C のキープアライブ ping コストは C の報告純コストに含まれます** — プロキシ自身の支出に隠されるものは何もありません。

## シナリオ

| # | 名前 | パターン | 検証内容 |
|---|---|---|---|
| S1 | agent-coding | 40 コールのエージェントループ、0–90 秒間隔、約 9k トークンの system+tools | 定常的なエージェントトラフィックにおける自動ブレークポイントの価値 |
| S2 | support-sparse | 12 会話、会話間に **6–9 分のアイドル** | 旗艦シナリオ：あらゆる短いキャッシュ TTL より長い間隔 |
| S3 | rag-timestamp | システムプロンプトの**内部**にライブタイムスタンプを含む 30 コール | 実行中には誰にも直せないキャッシュブレーカー — プロキシは自身の注入を自動停止し、根本原因を特定する |
| S4 | batch-classify | 300 件の短いコール、約 5k トークンの共有プレフィックス | 定常状態のヒット率 + OpenAI `prompt_cache_key` ルーティング |
| S5 | lunch-hold | コール → **45 分アイドル** → コール | ウォームホールドのチャットコマンド（`cai:hold 1h`） |
| S6 | steady | 60 コール、30 秒間隔 | 定常状態のヒット率 — 負荷下での GPT-5.6 復元を含む（SDK デフォルトの 0% に対して 97.8% ヒット） |

S2 の `gpt-5.5` と `gpt-4o` のセルはパススルーチェックを兼ねています：OpenAI は 5.6 以前のモデルではアップストリーム側でキャッシュを保持するため、プロキシは意図的にそこには何も追加しません——アームはほぼ同一になるはずです。

## 公平性ルール

1. **キャッシュ名前空間の分離。** すべてのシステムプロンプトはソルトトークン `[bench <run-id> <arm> r<rep>]` で始まるため、アームや rep が互いのプロバイダー側キャッシュにヒットすることは決してありません。
2. **インターリーブ。** すべてのステップ内でアームは連続して実行される（A → B → C）ため、特定のアームだけが有利な時間帯やプロバイダー負荷を得ることはありません。
3. **実際のアイドル間隔。** キャッシュの期限切れは実時間で発生します。sparse シナリオは実際に待機します（rep あたり S2 ≈ 85 分、S5 ≈ 45 分）。rep は別々の名前空間で並列に実行されます。
4. **固定された会話スクリプト。** モデルの応答が後続のターンに渡されることは決してありません——応答長のばらつきが入力側コストを汚染することはありません。出力コストは参考値として別途報告します。
5. **プロバイダー報告の使用量のみ。** コストは usage ブロックのトークン数 × 公開定価です（`lib/pricing.mjs`、`packages/shared` をミラーリング）。caching.ai ダッシュボードはクロスチェックにのみ使用します。
6. **反復。** セルあたり 3 rep、平均（最小–最大）として報告します。一時的な 429/5xx はバックオフ付きでリトライし、リトライ回数を記録します。リトライしたコールはレイテンシのパーセンタイルから除外します。
7. **予算ガード。** すべてのコールは共有台帳に追記され、上限（デフォルト $150）に達すると実行全体がハードアボートします。

## 再現方法

前提条件：Node ≥ 20、caching.ai アカウント、ご自身のプロバイダーキー。

```sh
# 1. credentials (kept OUTSIDE the repo)
mkdir -p ~/.config/caching-bench && chmod 700 ~/.config/caching-bench
cat > ~/.config/caching-bench/env <<'ENV'
BENCH_EMAIL=you@example.com        # caching.ai console account
BENCH_PASSWORD=...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
# XAI_API_KEY=xai-...              # optional; Grok cells are skipped without it
ENV
chmod 600 ~/.config/caching-bench/env

# 2. register your provider keys on the account (console → Provider keys),
#    then mint one ck_ key per C-arm cell:
node bench/setup-keys.mjs

# 3. dry-run the harness (~$0.10)
node bench/run.mjs --run-id dry --scenario S6 --model haiku --reps 1 --limit-steps 4 --gap-scale 0.2 --budget 3

# 4. full matrix (~2 h wall clock, ~$60–90 at list prices)
node bench/orchestrate.mjs --run-id run-$(date +%Y%m%d) --budget 150

# 5. keep-alive ping attribution + summary
node bench/fetch-pings.mjs --run-id run-...   # self-hosters: reads request_logs; hosted users can read the console dashboard instead
node bench/analyze.mjs --run-id run-...
```

`fetch-pings.mjs` にはプロキシの Postgres 用の `DATABASE_URL` が必要です（セルフホストのデプロイなら当然持っているはずです）。ホスト型クラウドでは、同じ数字がコンソールダッシュボード（キープアライブ ping ／支出）に表示されます。いずれの場合も、実行の合計値は `/api/stats` とクロスチェックされます。

## レイアウト

```
scenarios/   declarative scenario definitions (gap schedules included)
fixtures/    synthetic prompts (gen-fixtures.mjs regenerates them byte-identically)
lib/         pricing tables, provider callers, matrix, helpers
run.mjs      one cell: arms interleaved per step, reps in parallel
orchestrate.mjs  the full matrix with a shared budget cap
analyze.mjs  raw JSONL → summary.json / summary.md
results/     raw logs of the published set (run-202607-v0100) — committed, secrets redacted at write time
```

フィクスチャのテキストはすべて合成です（架空の製品、シード付きジェネレーター）。公開セットの生の結果は、書き込み時にシークレットをリダクトした上で、失敗したコールも含めてコミットされています。
