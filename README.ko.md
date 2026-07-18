[English](README.md) | **한국어** | [日本語](README.ja.md) | [中文](README.zh.md) | [Español](README.es.md)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/logo-dark.png">
    <img src="apps/web/public/logo.png" alt="caching.ai" width="360">
  </picture>
</p>

<p align="center">
  <b>AI 프롬프트 캐시를 따뜻하게 지켜 청구서를 가볍게 만들어주는 프록시예요.</b><br/>
  Anthropic, OpenAI, Gemini, Grok에 그대로 꽂아 쓸 수 있어요. base URL 한 줄만 바꾸면 돼요.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
  <a href="https://www.npmjs.com/package/cache-guard"><img src="https://img.shields.io/npm/v/cache-guard?label=cache-guard" alt="npm" /></a>
  <a href="https://caching.ai"><img src="https://img.shields.io/badge/cloud-caching.ai-00d722" alt="Cloud" /></a>
</p>

---

모델 프로바이더들은 반복되는 프롬프트 프리픽스(prefix)에 이미 약 90% 할인을 해줘요 — 단, 캐시가 따뜻하게 유지되는 동안만요. 실제 트래픽에서는 캐시가 소리 없이 만료되거나(유휴 약 5분) 깨져서(프리픽스의 불안정한 바이트 하나) 다시 정가를 내게 돼요. Caching.ai는 앱과 프로바이더 사이에 앉아 이 할인이 실제로 적용되게 만들어줘요:

- **캐시 분석** — 실제 히트율, 절감한 금액, 그리고 아무도 보여주지 않는 숫자: 캐시됐어야 하는데 놓쳐서 낭비된 금액까지 보여줘요. 토큰 수만 기록하고, 프롬프트/응답 본문은 절대 저장하지 않아요.
- **캐시 가드** — `cache_control` 자동 주입(Anthropic), GPT-5.6+ 캐시 복원(5.6 세대는 breakpoint에서만 매칭돼서, 단순한 공유 프리픽스는 크로스 요청 히트가 0%예요 — 우리는 명시적인 `prompt_cache_breakpoint`와 안정적인 `prompt_cache_key`를 주입해요. 실측으로 0% → 99.6% 프리픽스 히트 검증 완료), 그리고 캐시 브레이커 탐지와 유력한 근본 원인(타임스탬프, 랜덤 ID, 순서가 바뀐 tools)까지 알려줘요.
- **Keep-alive 워머** *(키별 opt-in, Anthropic 전용 — 의도된 설계예요)* — 1토큰 핑으로 재사용이 경제적인 동안만(최대 62.5분) 프리픽스를 다시 데워요. 일일 예산은 직접 정할 수 있어요. 다른 프로바이더들은 업스트림에서 캐시를 스스로 유지해요(직접 측정했어요 — [BENCHMARK.ko.md](BENCHMARK.ko.md)). 그래서 핑이 이득이 안 되는 곳에는 프록시가 예산을 절대 쓰지 않아요. 긴 홀드는 핑 스트림 대신 1h-TTL 쓰기 한 번으로 처리해요.
  잠시 자리를 비우시나요? 채팅에 `"keep my cache warm for 2 hours"`라고 보내면 프록시가 직접 답하고 워머를 유지해줘요(아래 참고).
- **프리픽스 옵티마이저** — 요청 사이에 프롬프트의 어느 부분이 바뀌는지 측정하고 어떻게 고치면 되는지 알려줘요.

<p align="center">
  <img src=".github/assets/hero-cache-warm.png" alt="A robot keeping the cache flame warm while the cold one costs 10x" width="640">
</p>

**약속이 아니라 측정이에요:** caching.ai와 프로바이더 직접 호출을 비교 벤치마크했어요 — 3개 arm, 6개 트래픽 패턴, 약 1만 건의 실제 과금 호출, raw 로그 전부 커밋되어 있고 여러분의 키로 다시 돌려볼 수 있어요. [BENCHMARK.ko.md](BENCHMARK.ko.md)를 확인해 보세요.

모든 SDK와 함께 동작해요 — 연동은 base URL 교체 한 번이면 돼요:

```bash
# before
ANTHROPIC_BASE_URL=https://api.anthropic.com
# after
ANTHROPIC_BASE_URL=https://your-proxy-host   # or https://proxy.caching.ai
ANTHROPIC_API_KEY=ck_your_caching_ai_key
```

## 쉬운 말로 설명하는 warm hold

아무 SDK로나 짧은 채팅 메시지 하나를 보내면 프록시가 그걸 가로채서 즉시 답하고, 업스트림으로는 절대 전달하지 않아요. 그래서 토큰 비용이 0이에요:

```
"keep my cache warm for 2 hours"
"캐시 2시간 지켜줘" · "キャッシュを2時間保温して"
"mantén mi caché caliente 2 horas" · "帮我保温缓存 2 小时"
cai:hold 45m          # explicit command — works anywhere, any language

→ 🔥 Warming held for 2 hours. (answered at the proxy, $0)
```

기본값은 2시간이고, 5분 – 12시간 범위로 제한돼요. 모든 경로에서 동작해요 — Anthropic Messages, OpenAI chat & responses(Codex), Gemini, Grok — 그리고 질문한 언어(ko/en/ja/es/zh)로 답해줘요. 메시지는 짧아야 하고(60자 이하) 캐시에 관한 내용이라는 게 분명해야 해요. 실제 프롬프트처럼 보이는 건 전부 그대로 통과시켜요. 키에 keep-alive가 켜져 있어야 하고, 일일 워머 예산도 그대로 적용돼요. 홀드가 유지되는 동안 콘솔에는 "Warm hold active · until HH:MM" 배지가 표시돼요.

## Cloud vs. 셀프호스트

| | **Caching.ai Cloud** | **셀프호스트** |
|---|---|---|
| 운영 | 제로 — 프록시, 워머 데몬, 대시보드를 24/7 저희가 운영해요 | 직접 운영해요 |
| 가격 | *검증된 순절감액*의 20%, 월 $5 미만이면 면제예요 | 영원히 무료예요 |
| 빌링 인프라 | 후불 카드 등록, 절감액 검증 포함이에요 | 필요 없어요 |
| 시작하기 | [caching.ai](https://caching.ai) — 2분이면 돼요 | 아래 `docker compose up`을 따라 하세요 |

저희가 아무것도 절감해주지 못하면 여러분도 아무것도 내지 않아요 — 그게 가격 모델의 전부예요.

## 호스티드 클라우드는 뭘 더 해주나요

셀프호스트로도 프록시 전체를 쓸 수 있어요. 클라우드는 직접 돌리기 번거로운 부분을 얹어드려요:

- **자동 최적화(Auto-Tune)** *(클라우드 전용 — [`ee/`](ee/README.md))*: 키마다 실제 호출 리듬을 학습해서, 트래픽이 변해도 가장 싼 캐시 설정을 계속 다시 골라줘요. 오토파일럿 위의 "켜두면 끝" 레이어예요.
- **검증된 절감액 기반 과금**: 실제로 아껴드린 금액(워머 핑 비용까지 뺀 순절감)을 계측해 그 20%만 받아요. 월 $5 미만은 청구하지 않아요. 못 아끼면 못 받아요.
- **리포트가 바로 와요**: 주간 절감 리포트 메일과 일일 예산 알림이 설정 없이 도착해요(셀프호스트는 Resend 키를 직접 넣어야 해요).
- **운영 제로**: 프록시 플릿·워머 데몬·Postgres·마이그레이션·업그레이드 전부 저희 몫이에요.
- **가입부터 절감까지 2분**: [caching.ai](https://caching.ai) → 프로바이더 키 등록 → base URL 하나 교체.

## 셀프호스팅

요구 사항: Docker + Docker Compose.

```bash
git clone https://github.com/caching-ai/caching.ai.git
cd caching.ai
cp .env.example .env          # then fill in the two secrets:
# ENCRYPTION_KEY=$(openssl rand -hex 32)
# SESSION_SECRET=$(openssl rand -hex 32)
docker compose up -d --build
```

- 웹 콘솔 → http://localhost:3000
- 프록시 → http://localhost:8787 (liveness: `/healthz`, readiness: `/readyz` — 데이터베이스를 확인해요)

콘솔에서 가입하고, 프로바이더 API 키를 등록하고(AES-256-GCM으로 암호화 저장돼요), `ck_` 키를 만든 다음, SDK의 base URL을 프록시로 향하게 하면 돼요. Postgres 마이그레이션은 프록시가 부팅될 때 자동으로 실행돼요.

선택 연동(전부 기본 꺼짐): Google OAuth(`GOOGLE_CLIENT_ID/SECRET`), 트랜잭션 이메일(`RESEND_API_KEY` — 가입 인증, 주간 절감 리포트, keep-alive 예산 알림이 켜지고, 전부 원클릭 RFC 8058 수신거부를 지원해요), Prometheus 메트릭(`METRICS_TOKEN` → `GET /metrics`에 `authorization: Bearer <token>`: 요청/토큰/비용/절감 카운터, keep-alive 핑 비용, 레이턴시 히스토그램, DB 풀 게이지), raw 로그 보존 기간 조정(`LOG_RETENTION_DAYS`, 기본 100 — 완료된 날짜는 정리 전에 `request_logs_daily`로 롤업돼요), 업스트림 URL 오버라이드(`UPSTREAM_URL`, `OPENAI_UPSTREAM_URL`, `GEMINI_UPSTREAM_URL`, `GROK_UPSTREAM_URL`), 그리고 후불 빌링 파이프라인(`BILLING_LIVE=1` + Stripe/Toss 키 — 셀프호스트에서는 거의 확실히 필요 없을 거예요). 모든 옵션은 [.env.example](.env.example)에 주석과 함께 정리되어 있어요.

## 아키텍처

pnpm 모노레포예요:

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

### CI에서 캐시 브레이커 잡기

[`cache-guard`](https://www.npmjs.com/package/cache-guard)는 Anthropic Messages 요청 픽스처의 캐시 가능한 프리픽스(tools, system, 첫 메시지)를 해시하는 작은 npm CLI예요 — 실수로 프롬프트 프리픽스를 불안정하게 만드는 PR이 청구서를 조용히 10배로 만드는 대신 CI에서 실패하게 해줘요:

```bash
npx cache-guard snapshot fixtures/*.json   # write the .cacheguard.json baseline
npx cache-guard check fixtures/*.json      # exit 1 if any prefix hash changed
```

프라이버시 모델: 프록시는 토큰 수, 모델 이름, 레이턴시, 상태 코드, 그리고 프리픽스 블록의 SHA-256 해시만 저장해요 — 프롬프트나 응답 본문은 절대 저장하지 않아요. 유일한 예외는 opt-in keep-alive예요. 캐시를 따뜻하게 유지하려면 마지막 프롬프트 프리픽스를 다시 보내야 해서, 그 프리픽스를 암호화(AES-256-GCM)해 저장해요. 여러분의 데이터베이스니까, 이 모든 걸 코드에서 직접 확인할 수 있어요.

## 개발

```bash
pnpm install
cd apps/proxy && pnpm test    # needs local Postgres 16
cd apps/web && pnpm dev
```

[CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요. 보안 제보는 [SECURITY.md](SECURITY.md)로 부탁해요.

## 라이선스

[Apache-2.0](LICENSE) © 2026 AI3 Inc. — 이 저장소의 모든 것에 적용돼요. 단, `ee/` 디렉터리는 예외로, 상업 라이선스 하에 소스가 공개되어 있어요([ee/README.md](ee/README.md) 참고). 셀프호스트 빌드는 `ee/` 없이도 완전하게 동작해요. "caching.ai"와 불꽃 로고는 AI3 Inc.의 상표예요 — [NOTICE](NOTICE)를 참고하세요.
