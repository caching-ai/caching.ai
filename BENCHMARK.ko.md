[English](BENCHMARK.md) | **한국어** | [日本語](BENCHMARK.ja.md) | [中文](BENCHMARK.zh.md) | [Español](BENCHMARK.es.md)

# caching.ai는 정말 돈을 아껴줄까요? 직접 측정했어요.

3개 arm, 6개 트래픽 패턴, 7개 모델, **정가 기준 10,000건 이상의 실제 API 호출**(2026-07, proxy v0.10.0)이에요. 여기 있는 모든 건 여러분의 키로 재현할 수 있어요 — 방법론, 픽스처, 러너, raw 로그가 [`bench/`](bench/README.ko.md)에 있어요.

**Arm 구성.** A = 프로바이더 직접 호출, 캐시 힌트 없음(SDK 기본값). B = 직접 호출이지만 우리 프록시가 넣을 자리에 정확히 수동으로 `cache_control`을 배치(Anthropic 전용 — OpenAI/Gemini/Grok은 자동 캐싱이라 거기서는 A ≡ B예요). C = 같은 요청을 caching.ai를 통해 보내고, **keep-alive 핑 비용까지 차감한 순비용**이에요. 비용은 프로바이더가 보고한 usage 토큰 × 공개 정가로 계산했고, 고정된 대화 스크립트를 썼으며, arm별 salt 토큰을 넣어 arm끼리 프로바이더 캐시를 절대 공유할 수 없게 했어요. 자세한 내용: [`bench/README.ko.md`](bench/README.ko.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/bench-scenarios-dark.svg">
  <img alt="Input-side cost of arms A/B/C across scenarios on claude-haiku-4.5" src=".github/assets/bench-scenarios-light.svg" width="820">
</picture>

## caching.ai가 이기는 곳

| 워크로드(claude-haiku-4.5) | A 직접 호출 | C caching.ai(순비용) | 절감 |
|---|---|---|---|
| S2 sparse support — 12회 호출, 6–9분 유휴 | $0.0720 | **$0.0240** (핑 16회 포함) | **67%** |
| S1 agent loop — 40회 호출, 0–90초 간격 | $0.4104 | **$0.1378** | **66%** |
| S4 classify batch — 300회 호출 | $1.7268 | **$0.1868** | **89%** |
| S6 steady traffic — 60회 호출, 30초 간격 | $0.3123 | **$0.0387** | **88%** |

claude-sonnet-5에서도 같은 패턴이에요: 직접 호출 대비 S2 **68%**, S1 **69%** 절감이에요.

이 결과를 만드는 요인은 두 가지예요:

1. **Anthropic 캐싱은 opt-in인데, 대부분의 연동은 opt-in을 안 해요.** 모든 Anthropic 셀에서 arm A의 히트율은 0%예요 — SDK 기본값 트래픽이 딱 이런 모습이에요. C는 breakpoint를 자동으로 주입하고, 수동 튜닝한 B와 토큰 단위까지 일치해요(S1/S4/S6: B와 C가 바이트 단위로 동일).
2. **짧은 TTL은 유휴 구간에서 죽어요.** S2에서는 수동 튜닝한 B가 오히려 순진한 A보다 **25% 더 비싸요**: 6–9분 간격마다 캐시가 만료돼서 1.25배 쓰기 프리미엄을 열두 번 내고 읽기는 한 번도 못 해요. C의 keep-alive는 프리픽스를 따뜻하게 유지하고(히트율 91%), 모든 핑 비용을 내고도 67%를 절감해요.

## GPT-5.6: 새 모델이 잃어버린 캐싱을 프록시가 복원해요

GPT-5.6 세대 모델은 **breakpoint 범위 캐싱**으로 넘어갔고, 암묵적 breakpoint는 *가장 최근 메시지*에 붙어요 — 그래서 공유 시스템 프롬프트를 쓰는 일반 SDK 트래픽은 **크로스 요청 프리픽스 히트가 0%**예요(`gpt-5.6-sol`에서 수천 건을 측정했어요: 바이트 단위로 동일한 반복 프롬프트만 히트했어요). 프록시는 요청에 자체 캐싱 파라미터가 없을 때마다 문서화된 해결책 — 공유 프리픽스 끝에 명시적 `prompt_cache_breakpoint`와 안정적인 `prompt_cache_key` — 을 chat/completions와 Responses API 양쪽에 주입해요. 측정 결과(`gpt-5.6-sol`, 위와 같은 하네스와 arm 구성):

| 워크로드 | A 직접 호출(히트율) | C caching.ai(히트율) | 절감 |
|---|---|---|---|
| S6 steady traffic — 60회 호출, 30초 간격 | $1.6964 (0%) | **$0.1705 (97.8%)** | **90%** |
| S2 sparse support — 12회 호출, 6–9분 유휴 | $0.3911 (0%) | **$0.0636 (91.0%)** | **84%** |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/bench-s2-models-dark.svg">
  <img alt="S2 sparse support: cost of each arm relative to direct, per model" src=".github/assets/bench-s2-models-light.svg" width="820">
</picture>

## 모델 프로바이더별 동작 노트

- **OpenAI(5.6 이전), Gemini, Grok**: 이 프로바이더들은 업스트림에서 캐시를 스스로 유지해요. 그래서 프록시는 트래픽을 건드리지 않고 그대로 통과시켜요 — 핑도, 라우팅 키 주입도, 쓰기 프리미엄도 없어요. S2 sparse 측정: gpt-4o **$0.0878 vs $0.0878**(동일, 양쪽 모두 87.7% 히트), gemini-2.5-flash **$0.0190 vs $0.0190** — 바이트 단위로 동일한 pass-through 비용이에요. (gpt-5.5는 저희 rep에서 프록시를 거친 쪽이 23% 더 쌌어요 — 프로바이더 쪽 캐시 라우팅 편차이고, 동등한 수준을 기대하면 돼요.) 그 위에 미터링, 브레이커 진단, 예산 컨트롤이 얹혀요.
- **불안정한 프리픽스**(시스템 프롬프트 안의 타임스탬프나 랜덤 ID)는 누구도 캐시할 수 없어요. 프록시는 대시보드에서 브레이커와 유력한 근본 원인을 짚어주고, 프리픽스가 계속 바뀌는 동안에는 자체 주입을 자동으로 멈춰요 — 깨진 프롬프트가 쓰기 프리미엄을 사게 두지 않아요.
- **Warm hold**(채팅으로 "keep my cache warm for 2 hours"): 긴 홀드는 1h-TTL 캐시 쓰기 한 번 + 시간당 리프레시로 처리하고, 짧은 홀드는 0.1배 핑으로 이어요 — 요청한 시간 창에서 더 싼 쪽을 골라요.

**레이턴시.** 대부분의 셀에서 프록시 홉은 프로바이더 노이즈보다 작았어요: TTFT p50 델타는 −77ms(C가 더 빠름, 캐시 히트)부터 +121ms(순수 pass-through 셀)까지였어요.

## 재현하기

```sh
node bench/setup-keys.mjs
node bench/orchestrate.mjs --run-id run-$(date +%Y%m%d) --budget 150
node bench/analyze.mjs --run-id run-...
```

공개된 모든 셀의 raw JSONL(기록 시점에 시크릿 마스킹, 실패 건 포함)은 [`bench/results/run-202607-v0100/`](bench/results/run-202607-v0100/)에 있고, 셀별 집계는 그 안의 `summary.md`에 있어요. 가격: 2026-07 기준 공개 정가(`bench/lib/pricing.mjs` 참고). 유의 사항: 단일 리전(클라이언트는 서울)이고, Anthropic 셀은 독립 3회 실행의 평균이며, GPT-5.6 세대와 pass-through 셀은 proxy v0.10.0에서 셀당 1회 실행으로 측정했어요.
