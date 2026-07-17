// Synthetic provider-wire responses for warm-hold commands. The command is
// answered by the proxy itself — nothing is forwarded upstream (zero cost),
// so the reply must look exactly like a normal completion to the caller's
// SDK, in both non-stream and SSE form.

const sse = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export function anthropicHoldResponse(model: string, text: string, isStream: boolean): Response {
  if (!isStream) {
    return new Response(
      JSON.stringify({
        id: "msg_cai_hold",
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  const body =
    sse("message_start", {
      type: "message_start",
      message: {
        id: "msg_cai_hold", type: "message", role: "assistant", model,
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }) +
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
    sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }) +
    sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } }) +
    sse("message_stop", { type: "message_stop" });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

/** OpenAI Responses API wire format (Codex and friends) */
export function responsesHoldResponse(model: string, text: string, isStream: boolean, created: number): Response {
  const message = {
    type: "message", id: "msg_cai_hold", status: "completed", role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  const response = {
    id: "resp_cai_hold", object: "response", created_at: created, status: "completed",
    model, output: [message], output_text: text, parallel_tool_calls: true,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
  if (!isStream) {
    return new Response(JSON.stringify(response), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  const body =
    sse("response.created", { type: "response.created", response: { ...response, status: "in_progress", output: [], output_text: "" } }) +
    sse("response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } }) +
    sse("response.content_part.added", { type: "response.content_part.added", item_id: message.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }) +
    sse("response.output_text.delta", { type: "response.output_text.delta", item_id: message.id, output_index: 0, content_index: 0, delta: text }) +
    sse("response.output_text.done", { type: "response.output_text.done", item_id: message.id, output_index: 0, content_index: 0, text }) +
    sse("response.content_part.done", { type: "response.content_part.done", item_id: message.id, output_index: 0, content_index: 0, part: { type: "output_text", text, annotations: [] } }) +
    sse("response.output_item.done", { type: "response.output_item.done", output_index: 0, item: message }) +
    sse("response.completed", { type: "response.completed", response });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

/** Gemini generateContent / streamGenerateContent wire format */
export function geminiHoldResponse(
  model: string, text: string, mode: "json" | "sse" | "array"
): Response {
  const chunk = {
    candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
    modelVersion: model,
  };
  if (mode === "sse") {
    return new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
      status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
  }
  // streamGenerateContent without alt=sse returns a JSON array of chunks
  const payload = mode === "array" ? [chunk] : chunk;
  return new Response(JSON.stringify(payload), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

export function openaiHoldResponse(model: string, text: string, isStream: boolean, created: number): Response {
  if (!isStream) {
    return new Response(
      JSON.stringify({
        id: "chatcmpl-cai-hold",
        object: "chat.completion",
        created,
        model,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  const chunk = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-cai-hold", object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  const body =
    chunk({ role: "assistant", content: text }, null) + chunk({}, "stop") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}
