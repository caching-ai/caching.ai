import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";

export interface MockState {
  /** every body received on /v1/messages, in order */
  bodies: any[];
  /** every x-api-key header received */
  keys: string[];
  /** force a status for the next responses (0 = normal) */
  forceStatus: number;
  /** usage to return */
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  /** ms delay between SSE chunks (for buffering tests) */
  sseChunkDelayMs: number;
}

export function makeMockAnthropic() {
  const state: MockState = {
    bodies: [],
    keys: [],
    forceStatus: 0,
    usage: {
      input_tokens: 10,
      output_tokens: 25,
      cache_creation_input_tokens: 2048,
      cache_read_input_tokens: 4096,
    },
    sseChunkDelayMs: 0,
  };

  const app = new Hono();

  app.post("/v1/messages", async (c) => {
    const body = await c.req.json();
    state.bodies.push(body);
    state.keys.push(c.req.header("x-api-key") ?? "");

    if (state.forceStatus === 401) {
      return c.json(
        { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
        401
      );
    }
    if (state.forceStatus >= 400) {
      return c.json({ type: "error", error: { type: "api_error", message: "forced" } }, state.forceStatus as any);
    }

    if (body.stream === true) {
      const enc = new TextEncoder();
      const delay = state.sseChunkDelayMs;
      const u = state.usage;
      const events = [
        `event: message_start\ndata: ${JSON.stringify({
          type: "message_start",
          message: {
            id: "msg_mock",
            model: body.model,
            usage: {
              input_tokens: u.input_tokens,
              output_tokens: 1,
              cache_creation_input_tokens: u.cache_creation_input_tokens,
              cache_read_input_tokens: u.cache_read_input_tokens,
            },
          },
        })}\n\n`,
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: u.output_tokens },
        })}\n\n`,
        `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
      ];
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const e of events) {
            controller.enqueue(enc.encode(e));
            if (delay) await new Promise((r) => setTimeout(r, delay));
          }
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    }

    return c.json({
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: "Hello from mock" }],
      stop_reason: "end_turn",
      usage: state.usage,
    });
  });

  app.get("/v1/models", (c) => c.json({ data: [{ id: "claude-opus-4-8" }] }));

  return { app, state };
}

export function startMock(port: number): Promise<{ server: ServerType; state: MockState; url: string }> {
  const { app, state } = makeMockAnthropic();
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, () =>
      resolve({ server, state, url: `http://127.0.0.1:${port}` })
    );
  });
}
