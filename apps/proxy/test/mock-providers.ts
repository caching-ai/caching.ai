import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";

// ---- OpenAI mock: /v1/chat/completions (+stream), /v1/responses ----

export interface OpenAIMockState {
  bodies: any[];
  authHeaders: string[];
  convIds: (string | undefined)[];
  forceStatus: number;
}

export function startMockOpenAI(port: number): Promise<{ server: ServerType; state: OpenAIMockState; url: string }> {
  const state: OpenAIMockState = { bodies: [], authHeaders: [], convIds: [], forceStatus: 0 };
  const app = new Hono();

  app.post("/v1/chat/completions", async (c) => {
    const body = await c.req.json();
    state.bodies.push(body);
    state.authHeaders.push(c.req.header("authorization") ?? "");
    state.convIds.push(c.req.header("x-grok-conv-id"));
    if (state.forceStatus)
      return c.json({ error: { message: "forced", type: "invalid_request_error" } }, state.forceStatus as any);

    const usage = {
      prompt_tokens: 3000,
      completion_tokens: 40,
      total_tokens: 3040,
      prompt_tokens_details: { cached_tokens: 2048 },
    };

    if (body.stream) {
      const enc = new TextEncoder();
      const chunks = [
        `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hel" } }] })}\n\n`,
        `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "lo" } }] })}\n\n`,
        `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [], usage })}\n\n`,
        "data: [DONE]\n\n",
      ];
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          for (const ch of chunks) ctrl.enqueue(enc.encode(ch));
          ctrl.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }
    return c.json({
      id: "chatcmpl-mock",
      object: "chat.completion",
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: "Hello from mock OpenAI" }, finish_reason: "stop" }],
      usage,
    });
  });

  app.post("/v1/responses", async (c) => {
    const body = await c.req.json();
    state.bodies.push(body);
    state.authHeaders.push(c.req.header("authorization") ?? "");
    return c.json({
      id: "resp-mock",
      object: "response",
      model: body.model,
      output: [{ type: "message", content: [{ type: "output_text", text: "hi" }] }],
      usage: { input_tokens: 1500, output_tokens: 20, input_tokens_details: { cached_tokens: 1024 } },
    });
  });

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, () =>
      resolve({ server, state, url: `http://127.0.0.1:${port}` })
    );
  });
}

// ---- Gemini mock: /v1beta/models/{model}:generateContent ----

export interface GeminiMockState {
  bodies: any[];
  keys: string[];
  forceStatus: number;
}

export function startMockGemini(port: number): Promise<{ server: ServerType; state: GeminiMockState; url: string }> {
  const state: GeminiMockState = { bodies: [], keys: [], forceStatus: 0 };
  const app = new Hono();

  app.post("/v1beta/models/:modelAction", async (c) => {
    const body = await c.req.json();
    state.bodies.push(body);
    state.keys.push(c.req.header("x-goog-api-key") ?? "");
    if (state.forceStatus)
      return c.json({ error: { code: state.forceStatus, message: "forced", status: "PERMISSION_DENIED" } }, state.forceStatus as any);
    return c.json({
      candidates: [{ content: { parts: [{ text: "Hello from mock Gemini" }], role: "model" } }],
      usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 30, cachedContentTokenCount: 4000, totalTokenCount: 5030 },
    });
  });

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, () =>
      resolve({ server, state, url: `http://127.0.0.1:${port}` })
    );
  });
}

// ---- Resend mock ----

export interface ResendMockState {
  sent: { to: string[]; subject: string; html: string; auth: string }[];
  forceStatus: number;
}

export function startMockResend(port: number): Promise<{ server: ServerType; state: ResendMockState; url: string }> {
  const state: ResendMockState = { sent: [], forceStatus: 0 };
  const app = new Hono();
  app.post("/emails", async (c) => {
    const body = await c.req.json();
    if (state.forceStatus) return c.json({ message: "forced" }, state.forceStatus as any);
    state.sent.push({ to: body.to, subject: body.subject, html: body.html, auth: c.req.header("authorization") ?? "" });
    return c.json({ id: "email_mock_" + state.sent.length });
  });
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, () =>
      resolve({ server, state, url: `http://127.0.0.1:${port}/emails` })
    );
  });
}
