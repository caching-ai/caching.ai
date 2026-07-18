[English](README.md) | **한국어** | [日本語](README.ja.md) | [中文](README.zh.md) | [Español](README.es.md)

# Caching.ai 효과성 벤치마크

[caching.ai](https://caching.ai)가 프로바이더 직접 호출 대비 실제로 얼마나 아껴주는지(혹은 못 아끼는지)를 6개 트래픽 패턴과 여러 모델에 걸쳐 측정해요. 여러분의 키로 재현하는 데 필요한 모든 게 이 폴더에 있어요: 시나리오 정의, 합성 픽스처, 러너, 그리고 raw 결과 로그(`results/`)예요. 핵심 요약은 [`../BENCHMARK.ko.md`](../BENCHMARK.ko.md)에 있어요.

## Arm 구성

| arm | 경로 | 대표하는 대상 |
|---|---|---|
| **A** direct-naive | 프로바이더 API, 캐시 힌트 없음 | 대부분의 실제 사용자(SDK 기본값) |
| **B** direct-tuned | 프로바이더 API, 마지막 system 블록 + 마지막 tool에 수동으로 `cache_control` 배치(프록시가 넣을 자리와 정확히 동일) | Anthropic을 꼼꼼히 쓰는 팀 |
| **C** caching.ai | 같은 요청을 기본 설정의 `ck_` 키로 `proxy.caching.ai`를 통해 전송(시나리오가 명시하면 keep-alive 추가) | caching.ai 사용자 |

OpenAI, Gemini, Grok에는 `cache_control` 옵션이 없어서(캐싱이 자동) 거기서는 A ≡ B이고, 해당 모델들은 두 개 arm으로 실행돼요. **C의 keep-alive 핑 비용은 C가 보고하는 순비용에 포함돼요** — 프록시 자체 지출에 숨겨진 건 아무것도 없어요.

## 시나리오

| # | 이름 | 패턴 | 검증하는 것 |
|---|---|---|---|
| S1 | agent-coding | 40회 호출 에이전트 루프, 0–90초 간격, 약 9k 토큰 system+tools | 꾸준한 에이전트 트래픽에서 자동 breakpoint의 가치 |
| S2 | support-sparse | 12개 대화, 대화 사이 **6–9분 유휴** | 플래그십: 모든 짧은 캐시 TTL보다 긴 간격 |
| S3 | rag-timestamp | 시스템 프롬프트 **안에** 실시간 타임스탬프가 있는 30회 호출 | 실행 중에는 누구도 못 고치는 캐시 브레이커 — 프록시가 자체 주입을 자동으로 멈추고 근본 원인을 짚어줘요 |
| S4 | batch-classify | 짧은 호출 300회, 약 5k 토큰 공유 프리픽스 | 정상 상태 히트율 + OpenAI `prompt_cache_key` 라우팅 |
| S5 | lunch-hold | 호출 → **45분 유휴** → 호출 | warm-hold 채팅 명령(`cai:hold 1h`) |
| S6 | steady | 60회 호출, 30초 간격 | 정상 상태 히트율 — 부하 상황의 GPT-5.6 복원 포함(97.8% 히트 vs SDK 기본값 0%) |

S2의 `gpt-5.5`와 `gpt-4o` 셀은 pass-through 검증도 겸해요: OpenAI는 5.6 이전 모델의 캐시를 업스트림에서 유지하니까, 프록시는 의도적으로 아무것도 더하지 않아요 — arm들이 거의 동일하게 나오는 게 정상이에요.

## 공정성 규칙

1. **캐시 네임스페이스 격리.** 모든 시스템 프롬프트는 salt 토큰 `[bench <run-id> <arm> r<rep>]`으로 시작해요. 그래서 arm과 rep이 서로의 프로바이더 캐시를 절대 히트할 수 없어요.
2. **인터리빙.** 모든 스텝 안에서 arm들이 연달아 실행돼요(A → B → C). 특정 arm이 더 유리한 시간대나 프로바이더 부하를 만나는 일이 없어요.
3. **실제 유휴 간격.** 캐시 만료는 벽시계 기준이라, sparse 시나리오는 정말로 기다려요(rep당 S2 ≈ 85분, S5 ≈ 45분). rep들은 별도 네임스페이스에서 병렬로 실행돼요.
4. **고정된 대화 스크립트.** 모델 응답은 이후 턴에 절대 입력되지 않아요 — 응답 길이 편차가 입력 쪽 비용을 오염시킬 수 없어요. 출력 비용은 참고 수치로 따로 보고해요.
5. **프로바이더 보고 usage만 사용.** 비용은 usage 블록 토큰 × 공개 정가예요(`lib/pricing.mjs`, `packages/shared`를 미러링). caching.ai 대시보드는 교차 검증에만 써요.
6. **반복.** 셀당 3회 rep, 평균(최소–최대)으로 보고해요. 일시적 429/5xx는 백오프로 재시도하고 재시도 횟수를 로그에 남기며, 재시도된 호출은 레이턴시 백분위수에서 제외해요.
7. **예산 가드.** 모든 호출이 공유 원장에 기록되고, 전체 실행은 상한(기본 $150)에서 강제 중단돼요.

## 재현하기

사전 준비: Node ≥ 20, caching.ai 계정, 그리고 여러분의 프로바이더 키.

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

`fetch-pings.mjs`는 프록시 Postgres의 `DATABASE_URL`이 필요해요(셀프호스트 배포는 정의상 이걸 갖고 있어요). 호스티드 클라우드에서는 같은 숫자를 콘솔 대시보드(keep-alive 핑 / 지출)에서 볼 수 있고, 어느 쪽이든 실행 합계는 `/api/stats`와 교차 검증해요.

## 구성

```
scenarios/   declarative scenario definitions (gap schedules included)
fixtures/    synthetic prompts (gen-fixtures.mjs regenerates them byte-identically)
lib/         pricing tables, provider callers, matrix, helpers
run.mjs      one cell: arms interleaved per step, reps in parallel
orchestrate.mjs  the full matrix with a shared budget cap
analyze.mjs  raw JSONL → summary.json / summary.md
results/     raw logs of the published set (run-202607-v0100) — committed, secrets redacted at write time
```

모든 픽스처 텍스트는 합성이에요(가상의 제품, 시드 기반 생성기). 공개 세트의 raw 결과는 기록 시점에 시크릿을 마스킹한 채로 커밋되어 있고, 실패한 호출도 포함돼 있어요.
