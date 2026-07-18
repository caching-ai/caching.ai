[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | **中文** | [Español](README.es.md)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/logo-dark.png">
    <img src="apps/web/public/logo.png" alt="caching.ai" width="360">
  </picture>
</p>

<p align="center">
  <b>让你的 AI 提示词缓存保持温热、账单保持低廉的代理。</b><br/>
  即插即用，支持 Anthropic、OpenAI、Gemini 和 Grok。只需替换一个 base-URL。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
  <a href="https://www.npmjs.com/package/cache-guard"><img src="https://img.shields.io/npm/v/cache-guard?label=cache-guard" alt="npm" /></a>
  <a href="https://caching.ai"><img src="https://img.shields.io/badge/cloud-caching.ai-00d722" alt="Cloud" /></a>
</p>

---

模型提供商已经对重复的提示词前缀给出约 90% 的折扣——但只在缓存保持温热
期间有效。在真实流量中，缓存会悄无声息地过期（约 5 分钟空闲）或失效
（前缀中一个不稳定的字节），你就要再次支付全价。Caching.ai 位于你的应用
和提供商之间，让这个折扣真正落地：

- **缓存分析** —— 真实命中率、节省的金额，以及没人展示给你看的那个数字：
  本应被缓存却没有被缓存的提示词浪费了多少钱。只记录 token 数量；
  绝不存储提示词/响应正文。
- **缓存守护** —— 自动注入 `cache_control`（Anthropic）、GPT-5.6+ 缓存修复
  （5.6 一代只在断点处匹配，因此朴素的共享前缀在跨请求时命中率为 0%——
  我们注入显式的 `prompt_cache_breakpoint` 外加一个稳定的
  `prompt_cache_key`，实测验证前缀命中率从 0% → 99.6%），
  以及缓存破坏者检测并给出可能的根因
  （时间戳、随机 ID、工具顺序变动）。
- **保活预热** *（按密钥选择启用，仅限 Anthropic——这是有意为之的设计）* ——
  1-token 探测在复用仍然划算的时间窗口内（最长 62.5 分钟）为你的前缀
  重新保温，且不超出你控制的每日预算。其他提供商会自行在上游保持缓存
  （我们实测过——[BENCHMARK.zh.md](BENCHMARK.zh.md)），
  因此代理绝不会在探测无法回本的地方花费你的预算。长时间保温
  会以单次 1h-TTL 写入的方式提供，而不是持续的探测流。
  要离开一会儿？在聊天中说一句 `"keep my cache warm for 2 hours"`
  ——代理会自行应答并保持预热（见下文）。
- **前缀优化器** —— 测量你的提示词在请求之间发生变化的部分，
  并告诉你如何修复。

<p align="center">
  <img src=".github/assets/hero-cache-warm.png" alt="A robot keeping the cache flame warm while the cold one costs 10x" width="640">
</p>

**实测数据，而非空口承诺：** 我们将 caching.ai 与直接调用提供商进行了
基准对比——三个实验组、六种流量模式、约 10k 次真实计费调用，原始日志
已提交并可用你自己的密钥重新运行。参见
[BENCHMARK.zh.md](BENCHMARK.zh.md)。

兼容所有 SDK——集成只需替换一个 base-URL：

```bash
# before
ANTHROPIC_BASE_URL=https://api.anthropic.com
# after
ANTHROPIC_BASE_URL=https://your-proxy-host   # or https://proxy.caching.ai
ANTHROPIC_API_KEY=ck_your_caching_ai_key
```

## 保温指令，通俗解释

通过任意 SDK 发送一条简短的聊天消息——代理会拦截它、即时回复，
并且绝不转发到上游，因此花费为零 token：

```
"keep my cache warm for 2 hours"
"캐시 2시간 지켜줘" · "キャッシュを2時間保温して"
"mantén mi caché caliente 2 horas" · "帮我保温缓存 2 小时"
cai:hold 45m          # explicit command — works anywhere, any language

→ 🔥 Warming held for 2 hours. (answered at the proxy, $0)
```

默认 2 小时，限定在 5 分钟至 12 小时之间。适用于所有路径——Anthropic
Messages、OpenAI chat 与 responses（Codex）、Gemini、Grok——并以你提问
所用的语言回复（ko/en/ja/es/zh）。消息必须简短（≤ 60 个字符）且明确
是关于缓存的；任何看起来像真实提示词的内容都会原样透传。密钥必须启用
保活功能，且每日预热预算仍然有效。保温生效期间，控制台会显示
"Warm hold active · until HH:MM" 徽章。

## 云端 vs. 自托管

| | **Caching.ai Cloud** | **自托管** |
|---|---|---|
| 运维 | 零负担——我们 24/7 运行代理、预热守护进程和仪表盘 | 你自己运行 |
| 价格 | 你的*净核实节省额*的 20%，每月低于 $5 免收 | 永久免费 |
| 计费设施 | 后付费绑卡，包含节省额核实 | 不需要 |
| 开始使用 | [caching.ai](https://caching.ai) —— 2 分钟 | 见下方 `docker compose up` |

如果我们没帮你省下一分钱，你就一分钱也不用付——这就是全部定价模式。

## 托管云版多给你什么

自托管就能用上完整代理。云版把那些自己运维起来麻烦的部分补上：

- **Auto-Tune** *(仅云版 — [`ee/`](ee/README.md))*：学习每把密钥的真实调用节奏，流量变化时持续重选最省钱的缓存设置。是 Autopilot 之上「设完就忘」的那一层。
- **按验证节省额计费**：我们计量你实际省下的钱（扣除所有保温信号成本），只收其中 20%。每月不足 $5 免收。省不到就不收。
- **报表开箱即到**：周度节省报告邮件和每日预算提醒无需配置（自托管需要自备 Resend 密钥）。
- **零运维**：代理集群、保温守护进程、Postgres、迁移和每次升级都由我们值班。
- **注册到省钱只要 2 分钟**：[caching.ai](https://caching.ai) → 登记服务商密钥 → 换一个 base URL。

## 自托管

前提条件：Docker + Docker Compose。

```bash
git clone https://github.com/caching-ai/caching.ai.git
cd caching.ai
cp .env.example .env          # then fill in the two secrets:
# ENCRYPTION_KEY=$(openssl rand -hex 32)
# SESSION_SECRET=$(openssl rand -hex 32)
docker compose up -d --build
```

- Web 控制台 → http://localhost:3000
- 代理 → http://localhost:8787（存活探测：`/healthz`，就绪探测：`/readyz`——
  会检查数据库）

在控制台注册账号，登记你的提供商 API 密钥（静态存储时以 AES-256-GCM
加密），创建一个 `ck_` 密钥，并将 SDK 的 base URL 指向代理。代理启动时
会自动运行 Postgres 迁移。

可选集成（默认全部关闭）：Google OAuth
（`GOOGLE_CLIENT_ID/SECRET`）、事务性邮件（`RESEND_API_KEY`——启用
注册验证、每周节省报告和保活预算告警，均带一键式 RFC 8058 退订）、
Prometheus 指标（`METRICS_TOKEN` → `GET /metrics`，携带
`authorization: Bearer <token>`：请求/token/成本/节省计数器、保活探测
成本、延迟直方图、DB 连接池仪表）、原始日志保留期调整
（`LOG_RETENTION_DAYS`，默认 100——完整天数会在清理前汇总到
`request_logs_daily`）、上游 URL 覆盖（`UPSTREAM_URL`、`OPENAI_UPSTREAM_URL`、
`GEMINI_UPSTREAM_URL`、`GROK_UPSTREAM_URL`），以及后付费计费
流水线（`BILLING_LIVE=1` + Stripe/Toss 密钥——自托管时你几乎肯定
不需要这个）。所有配置项都在
[.env.example](.env.example) 中附有注释列出。

## 架构

pnpm monorepo：

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

### 在 CI 中拦截缓存破坏者

[`cache-guard`](https://www.npmjs.com/package/cache-guard) 是一个小巧的 npm CLI，
它对 Anthropic Messages 请求 fixture 的可缓存前缀（tools、system、首条
消息）计算哈希——这样，意外破坏你提示词前缀稳定性的 PR 会在 CI 中
失败，而不是悄悄让你的账单翻 10 倍：

```bash
npx cache-guard snapshot fixtures/*.json   # write the .cacheguard.json baseline
npx cache-guard check fixtures/*.json      # exit 1 if any prefix hash changed
```

隐私模型：代理存储 token 数量、模型名称、延迟、状态码，以及前缀块的
SHA-256 哈希——绝不存储提示词或响应正文。唯一的例外是选择启用的
保活功能，它会加密（AES-256-GCM）存储最后一次的提示词前缀，因为
重新发送它正是缓存保温的方式。数据库在你手里——所有这些都可以在
代码中验证。

## 开发

```bash
pnpm install
cd apps/proxy && pnpm test    # needs local Postgres 16
cd apps/web && pnpm dev
```

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全报告：[SECURITY.md](SECURITY.md)。

## 许可证

[Apache-2.0](LICENSE) © 2026 AI3 Inc. —— 本仓库中的所有内容，
除了 `ee/` 目录，该目录在商业许可下源码可见
（见 [ee/README.md](ee/README.md)）；自托管构建无需它即可完整运行。
"caching.ai" 和火焰 logo 是 AI3 Inc. 的商标——
见 [NOTICE](NOTICE)。
