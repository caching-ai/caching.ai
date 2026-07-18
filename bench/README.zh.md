[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | **中文** | [Español](README.es.md)

# Caching.ai 效果基准测试

测量 [caching.ai](https://caching.ai) 相对于直接调用提供商实际能省下多少
（或省不下多少），覆盖六种流量模式和多个模型。用你自己的密钥复现所需
的一切都在本文件夹中：场景定义、合成 fixture、运行器，以及原始结果
日志（`results/`）。总览摘要见 [`../BENCHMARK.zh.md`](../BENCHMARK.zh.md)。

## 实验组

| 实验组 | 路径 | 代表的用户群 |
|---|---|---|
| **A** direct-naive | 提供商 API，无任何缓存提示 | 大多数真实用户（SDK 默认行为） |
| **B** direct-tuned | 提供商 API，在最后一个 system 块 + 最后一个 tool 上手工放置 `cache_control`（与代理放置的位置完全一致） | Anthropic 上勤勉的团队 |
| **C** caching.ai | 相同请求经由 `proxy.caching.ai`，使用默认设置的 `ck_` 密钥（+ 场景要求时启用保活） | caching.ai 用户 |

OpenAI、Gemini 和 Grok 没有 `cache_control` 配置项（缓存是自动的），
因此在那里 A ≡ B，这些模型只跑两个实验组。**C 的保活探测成本计入
C 上报的净成本**——代理自身的开销没有任何隐藏。

## 场景

| # | 名称 | 模式 | 测试内容 |
|---|---|---|---|
| S1 | agent-coding | 40 次调用的 agent 循环，0–90 秒间隔，约 9k-token 的 system+tools | 稳定 agent 流量下自动断点的价值 |
| S2 | support-sparse | 12 段对话，之间有 **6–9 分钟空闲** | 旗舰场景：间隔长于所有短缓存 TTL |
| S3 | rag-timestamp | 30 次调用，system prompt **内部**含实时时间戳 | 一个在途无人能修的缓存破坏者——代理自动暂停自身注入并指出根因 |
| S4 | batch-classify | 300 次短调用，共享约 5k-token 前缀 | 稳态命中率 + OpenAI `prompt_cache_key` 路由 |
| S5 | lunch-hold | 调用 → **45 分钟空闲** → 调用 | 保温聊天命令（`cai:hold 1h`） |
| S6 | steady | 60 次调用，每 30 秒一次 | 稳态命中率——包括负载下的 GPT-5.6 缓存修复（97.8% 命中 vs SDK 默认的 0%） |

S2 中的 `gpt-5.5` 和 `gpt-4o` 单元同时兼作透传检查：OpenAI 在 5.6 之前
的模型上自行在上游保留缓存，因此代理在那里刻意不做任何添加——
预期两个实验组几乎完全一致。

## 公平性规则

1. **缓存命名空间隔离。** 每个 system prompt 都以 salt token
   `[bench <run-id> <arm> r<rep>]` 开头，因此实验组和重复轮次绝不会命中
   彼此在提供商侧的缓存。
2. **交错执行。** 在每一步中，各实验组背靠背运行（A → B → C），
   因此没有哪个实验组能享受更友好的时段或提供商负载。
3. **真实的空闲间隔。** 缓存过期以真实时钟计；稀疏场景会真的等待
   （每轮 S2 ≈ 85 分钟，S5 ≈ 45 分钟）。重复轮次在独立的命名空间中
   并行运行。
4. **固定对话脚本。** 模型响应绝不会被喂入后续轮次——响应长度的
   波动无法污染输入侧成本。
   输出成本作为参考数字单独报告。
5. **只用提供商上报的用量。** 成本为 usage 块的 token 数 × 公开
   列表价格（`lib/pricing.mjs`，与 `packages/shared` 保持一致）。caching.ai
   仪表盘仅用于交叉核对。
6. **重复运行。** 每个单元跑三轮，以平均值（最小–最大）报告。瞬时的
   429/5xx 以退避重试并记录重试次数；重试过的
   调用不计入延迟百分位数。
7. **预算护栏。** 每次调用都追加到共享账本；整个运行在达到上限时
   硬性中止（默认 $150）。

## 复现步骤

前提条件：Node ≥ 20、一个 caching.ai 账号，以及你自己的提供商密钥。

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

`fetch-pings.mjs` 需要指向代理的 Postgres 的 `DATABASE_URL`（自托管
部署天然具备）。在托管云上，同样的数字可以在控制台仪表盘上查看
（保活探测/开销）；无论哪种方式，运行的总量都会与 `/api/stats`
交叉核对。

## 目录结构

```
scenarios/   declarative scenario definitions (gap schedules included)
fixtures/    synthetic prompts (gen-fixtures.mjs regenerates them byte-identically)
lib/         pricing tables, provider callers, matrix, helpers
run.mjs      one cell: arms interleaved per step, reps in parallel
orchestrate.mjs  the full matrix with a shared budget cap
analyze.mjs  raw JSONL → summary.json / summary.md
results/     raw logs of the published set (run-202607-v0100) — committed, secrets redacted at write time
```

所有 fixture 文本均为合成内容（虚构产品、带种子的生成器）。已发布
数据集的原始结果已提交至仓库，密钥在写入时脱敏，包含失败的调用。
