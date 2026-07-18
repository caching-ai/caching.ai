import type { Usage } from "@caching/shared";

export function emptyUsage(): Usage {
  return { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

export function mergeUsage(target: Usage, u: any) {
  if (!u || typeof u !== "object") return;
  for (const k of [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ] as const) {
    if (typeof u[k] === "number") target[k] = u[k];
  }
  // Anthropic per-TTL write breakdown — lets computeCost bill 1h writes at
  // their real 2x premium instead of assuming everything is a 5m write
  const cc = u.cache_creation;
  if (cc && typeof cc === "object") {
    if (typeof cc.ephemeral_5m_input_tokens === "number") {
      target.cache_creation_5m_input_tokens = cc.ephemeral_5m_input_tokens;
    }
    if (typeof cc.ephemeral_1h_input_tokens === "number") {
      target.cache_creation_1h_input_tokens = cc.ephemeral_1h_input_tokens;
    }
  }
}

/**
 * Generic SSE pass-through tap: forwards bytes untouched and immediately,
 * feeding each parsed `data:` JSON event to `onEvent`; calls `onDone` when
 * the stream ends. Never buffers or delays the stream.
 */
export function tapSse(
  onEvent: (evt: any) => void,
  onDone: () => void
): TransformStream<Uint8Array, Uint8Array> {
  let carry = "";
  const decoder = new TextDecoder();

  const scan = (text: string, final: boolean) => {
    carry += text;
    const lines = carry.split("\n");
    carry = final ? "" : lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        /* partial or non-JSON data line — ignore */
      }
    }
  };

  let doneCalled = false;
  const done = () => {
    if (doneCalled) return;
    doneCalled = true;
    onDone();
  };

  // `cancel` fires when the client aborts mid-stream (routine for agent
  // workloads) — still meter whatever usage we saw, or savings/billing
  // under-count. TS lib types lag the spec, hence the cast.
  const transformer = {
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      controller.enqueue(chunk); // forward first — never delay the stream
      scan(decoder.decode(chunk, { stream: true }), false);
    },
    flush() {
      scan(decoder.decode(), true);
      done();
    },
    cancel() {
      done();
    },
  } as Transformer<Uint8Array, Uint8Array>;
  return new TransformStream<Uint8Array, Uint8Array>(transformer);
}

/** Anthropic Messages SSE: usage from message_start + message_delta. */
export function tapSseUsage(onDone: (usage: Usage) => void) {
  const usage = emptyUsage();
  return tapSse(
    (evt) => {
      if (evt.type === "message_start") mergeUsage(usage, evt.message?.usage);
      else if (evt.type === "message_delta") mergeUsage(usage, evt.usage);
    },
    () => onDone(usage)
  );
}
