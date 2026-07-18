[English](BENCHMARK.md) | [한국어](BENCHMARK.ko.md) | [日本語](BENCHMARK.ja.md) | **中文** | [Español](BENCHMARK.es.md)

# caching.ai 真的能省钱吗？我们实测了。

三个实验组、六种流量模式、七个模型，**10,000+ 次按公开价格计费的真实
API 调用**（2026-07，proxy v0.10.0）。这里的一切都可以用你自己的密钥
复现——方法、fixture、运行器和原始日志都在
[`bench/`](bench/README.zh.md)。

**实验组。** A = 直接调用提供商，无任何缓存提示（SDK 默认行为）。B =
直接调用，手工放置 `cache_control`，位置与我们的代理完全一致
（仅限 Anthropic——OpenAI/Gemini/Grok 自动缓存，因此那里 A ≡ B）。C =
相同请求经由 caching.ai，**已扣除保活探测成本**。成本
为提供商上报的 usage token 数 × 公开列表价格；固定对话
脚本；每个实验组使用独立的 salt token，确保实验组之间绝不共享提供商缓存。
详情：[`bench/README.zh.md`](bench/README.zh.md)。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/bench-scenarios-dark.svg">
  <img alt="Input-side cost of arms A/B/C across scenarios on claude-haiku-4.5" src=".github/assets/bench-scenarios-light.svg" width="820">
</picture>

## caching.ai 的优势场景

| 工作负载（claude-haiku-4.5） | A 直连 | C caching.ai（净值） | 节省 |
|---|---|---|---|
| S2 稀疏客服 —— 12 次调用，6–9 分钟空闲 | $0.0720 | **$0.0240**（含 16 次探测） | **67%** |
| S1 agent 循环 —— 40 次调用，0–90 秒间隔 | $0.4104 | **$0.1378** | **66%** |
| S4 批量分类 —— 300 次调用 | $1.7268 | **$0.1868** | **89%** |
| S6 稳定流量 —— 60 次调用，每 30 秒一次 | $0.3123 | **$0.0387** | **88%** |

claude-sonnet-5 上呈现相同模式：相比直连，S2 节省 **68%**、S1 节省 **69%**。

两个因素驱动了这一结果：

1. **Anthropic 缓存需要主动启用，而大多数集成从未启用。** 实验组 A 在
   所有 Anthropic 单元中的命中率都是 0%——这就是 SDK 默认流量的真实
   样子。C 自动注入断点，并与手工调优的 B 精确到 token 地持平
   （S1/S4/S6：B 与 C 逐字节相同）。
2. **短 TTL 在空闲间隔中死亡。** 在 S2 中，手工调优的 B 实际上比朴素的
   A **贵 25%**：它的缓存在每个 6–9 分钟的间隔中都会过期，因此它支付了
   十二次 1.25× 的写入溢价，却一次也没读到。C 的保活让前缀保持温热
   （91% 命中率），在支付了每一次探测的成本之后仍然赢得 67% 的节省。

## GPT-5.6：代理修复了新一代模型丢掉的缓存

GPT-5.6 一代模型改为**以断点为作用域的缓存**，且隐式断点位于
*最新一条消息*上——因此使用共享 system prompt 的普通 SDK 流量的
跨请求前缀命中率为 **0%**（我们在 `gpt-5.6-sol` 上实测了数千次调用：
只有逐字节完全相同的重复提示词才会命中）。代理注入了文档记载的
补救方案——在共享前缀末尾放置显式的
`prompt_cache_breakpoint`，外加一个稳定的
`prompt_cache_key`——在 chat/completions 和 Responses API 两条路径上均生效，
前提是请求本身未携带任何缓存参数。实测结果
（`gpt-5.6-sol`，与上文相同的测试框架和实验组）：

| 工作负载 | A 直连（命中率） | C caching.ai（命中率） | 节省 |
|---|---|---|---|
| S6 稳定流量 —— 60 次调用，每 30 秒一次 | $1.6964 (0%) | **$0.1705 (97.8%)** | **90%** |
| S2 稀疏客服 —— 12 次调用，6–9 分钟空闲 | $0.3911 (0%) | **$0.0636 (91.0%)** | **84%** |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/bench-s2-models-dark.svg">
  <img alt="S2 sparse support: cost of each arm relative to direct, per model" src=".github/assets/bench-s2-models-light.svg" width="820">
</picture>

## 各模型提供商行为说明

- **OpenAI（5.6 之前）、Gemini、Grok**：这些提供商会自行在上游保持
  缓存，因此代理原样透传流量——不发探测、不注入路由键、没有写入
  溢价。在 S2 稀疏场景实测：
  gpt-4o **$0.0878 vs $0.0878**（完全相同，双方命中率均为 87.7%），
  gemini-2.5-flash **$0.0190 vs $0.0190**——逐字节一致的透传成本。
  （gpt-5.5 在我们的这一轮中经代理便宜了 23%——属于提供商侧
  缓存路由波动；预期应为持平。）你额外获得的是计量、破坏者诊断
  和预算控制。
- **不稳定前缀**（system prompt 中的时间戳或随机 ID）任何人都无法
  缓存。代理会在仪表盘上指出破坏者及其可能的根因，
  并在前缀持续变化期间自动暂停自己的注入——因此损坏的提示词
  绝不会白白购买写入溢价。
- **保温指令**（在聊天中发送 "keep my cache warm for 2 hours"）：长时间
  保温以单次 1 h-TTL 缓存写入加每小时刷新的方式提供；短时间保温
  用 0.1× 探测衔接——对你要求的时间窗口取更便宜的那种。

**延迟。** 在大多数单元中，代理跳数的开销小于提供商自身的噪声：TTFT
p50 差值范围从 −77 ms（C 更快，缓存命中）到 +121 ms（纯透传单元）。

## 复现方式

```sh
node bench/setup-keys.mjs
node bench/orchestrate.mjs --run-id run-$(date +%Y%m%d) --budget 150
node bench/analyze.mjs --run-id run-...
```

每个已发布单元的原始 JSONL（密钥在写入时已脱敏，含失败调用）位于
[`bench/results/run-202607-v0100/`](bench/results/run-202607-v0100/)，
各单元汇总数据在其 `summary.md` 中。价格：截至 2026-07 的公开列表
价格（见 `bench/lib/pricing.mjs`）。注意事项：单一地域（客户端位于
首尔）；Anthropic 单元为 3 次独立运行的平均值，GPT-5.6 一代及
透传单元在 proxy v0.10.0 上每单元测量 1 次。
