[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文](README.zh.md) | **Español**

# Benchmark de efectividad de caching.ai

Mide lo que [caching.ai](https://caching.ai) realmente ahorra (o no) frente
a llamar directamente a los proveedores, a lo largo de seis patrones de
tráfico y varios modelos. Todo lo necesario para reproducirlo con tus
propias claves está en esta carpeta: definiciones de escenarios, fixtures
sintéticas, el runner y los logs de resultados en bruto (`results/`). El
resumen principal vive en [`../BENCHMARK.es.md`](../BENCHMARK.es.md).

## Brazos

| brazo | ruta | a quién representa |
|---|---|---|
| **A** direct-naive | API del proveedor, sin pistas de caché | la mayoría de usuarios reales (defaults del SDK) |
| **B** direct-tuned | API del proveedor, `cache_control` colocado a mano en el último bloque system + la última tool (exactamente donde lo pondría el proxy) | un equipo aplicado en Anthropic |
| **C** caching.ai | la misma petición a través de `proxy.caching.ai` con una clave `ck_` en configuración por defecto (+ keep-alive donde el escenario lo indica) | usuarios de caching.ai |

OpenAI, Gemini y Grok no tienen la opción `cache_control` (el caching es
automático), así que ahí A ≡ B y esos modelos ejecutan dos brazos. **Los
costes de los pings de keep-alive de C forman parte del coste neto reportado
de C** — nada queda oculto en el gasto propio del proxy.

## Escenarios

| # | nombre | patrón | qué prueba |
|---|---|---|---|
| S1 | agent-coding | bucle de agente de 40 llamadas, pausas de 0–90 s, system+tools de ~9k tokens | el valor de los breakpoints automáticos bajo tráfico de agente constante |
| S2 | support-sparse | 12 conversaciones, **6–9 min inactivo** entre ellas | el escenario estrella: pausas más largas que cualquier TTL corto de caché |
| S3 | rag-timestamp | 30 llamadas con un timestamp en vivo **dentro** del system prompt | un rompedor de caché que nadie puede arreglar en vuelo — el proxy pausa automáticamente su propia inyección y nombra la causa raíz |
| S4 | batch-classify | 300 llamadas cortas, prefijo compartido de ~5k tokens | tasas de aciertos en estado estable + enrutado con `prompt_cache_key` de OpenAI |
| S5 | lunch-hold | llamada → **45 min inactivo** → llamada | el comando de chat de retención en caliente (`cai:hold 1h`) |
| S6 | steady | 60 llamadas, cada 30 s | tasas de aciertos en estado estable — incluida la restauración de GPT-5.6 bajo carga (97,8% de aciertos vs 0% con defaults del SDK) |

Las celdas `gpt-5.5` y `gpt-4o` en S2 sirven también como comprobaciones de
pass-through: OpenAI retiene su caché en el upstream en los modelos pre-5.6,
así que ahí el proxy deliberadamente no añade nada — espera brazos casi
idénticos.

## Reglas de imparcialidad

1. **Aislamiento de namespaces de caché.** Cada system prompt empieza con un
   token de sal `[bench <run-id> <arm> r<rep>]`, así que los brazos y las
   repeticiones nunca pueden acertar en las cachés del proveedor de los
   demás.
2. **Intercalado.** Dentro de cada paso los brazos se ejecutan uno tras otro
   (A → B → C), así que ningún brazo obtiene una hora del día ni una carga
   del proveedor más favorable.
3. **Pausas de inactividad reales.** La expiración de la caché es de reloj
   de pared; los escenarios dispersos esperan de verdad (S2 ≈ 85 min, S5
   ≈ 45 min por repetición). Las repeticiones se ejecutan en paralelo en
   namespaces separados.
4. **Guiones de conversación fijos.** Las respuestas del modelo nunca se
   reinyectan en turnos posteriores — la varianza de longitud de respuesta
   no puede contaminar el coste del lado de entrada. El coste de salida se
   reporta por separado como cifra de referencia.
5. **Solo uso reportado por el proveedor.** Los costes son tokens del bloque
   de uso × precios de lista públicos (`lib/pricing.mjs`, espejo de
   `packages/shared`). El dashboard de caching.ai se usa solo para
   contrastar.
6. **Repetición.** Tres repeticiones por celda, reportadas como media
   (mín–máx). Los 429/5xx transitorios se reintentan con backoff y el número
   de reintentos se registra; las llamadas reintentadas se excluyen de los
   percentiles de latencia.
7. **Guarda de presupuesto.** Cada llamada se anota en un libro mayor
   compartido; la ejecución completa se aborta en seco al llegar al tope
   (por defecto $150).

## Reproducción

Prerrequisitos: Node ≥ 20, una cuenta de caching.ai y tus propias claves de
proveedor.

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

`fetch-pings.mjs` necesita una `DATABASE_URL` para el Postgres del proxy
(los despliegues autoalojados la tienen por definición). En el cloud
gestionado, las mismas cifras están en el dashboard de la consola (pings /
gasto de keep-alive); los totales de la ejecución se contrastan con
`/api/stats` en cualquiera de los dos casos.

## Estructura

```
scenarios/   declarative scenario definitions (gap schedules included)
fixtures/    synthetic prompts (gen-fixtures.mjs regenerates them byte-identically)
lib/         pricing tables, provider callers, matrix, helpers
run.mjs      one cell: arms interleaved per step, reps in parallel
orchestrate.mjs  the full matrix with a shared budget cap
analyze.mjs  raw JSONL → summary.json / summary.md
results/     raw logs of the published set (run-202607-v0100) — committed, secrets redacted at write time
```

Todo el texto de las fixtures es sintético (productos inventados, generador
con semilla). Los resultados en bruto del conjunto publicado están
publicados en el repo con los secretos redactados en el momento de
escritura, con las llamadas fallidas incluidas.
