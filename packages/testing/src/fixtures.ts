import { createHash } from "node:crypto";
import type { CapabilityImplementation } from "@harness/capabilities";
import { type CapabilityId, type JsonObject, type ModelId, ModelIdSchema } from "@harness/contracts";
import type { ModelAdapter, ModelRequest, ModelResponse, ModelStreamEvent } from "@harness/models";
import { z } from "zod";

/**
 * Deterministic fake model adapter for contract tests (P00 spec §18). Output is
 * a pure function of the request. It never proposes tools unless asked to via
 * the literal user text "PROPOSE harness.echo", which tests use to show that a
 * proposal is data only.
 */
export class FakeDeterministicModelAdapter implements ModelAdapter {
  readonly capabilities = {
    model_id: ModelIdSchema.parse("fake.deterministic-v1") as ModelId,
    modalities: ["text" as const],
    max_context_tokens: 8_192,
    max_output_tokens: 1_024,
    supports_tool_proposals: true,
    supports_structured_output: false,
    supports_streaming: true,
  };

  async generate(request: ModelRequest, options: { signal?: AbortSignal } = {}): Promise<ModelResponse> {
    if (options.signal?.aborted) {
      return this.#response(request, "", [], "cancelled");
    }
    const last = request.messages.at(-1)?.content ?? "";
    const digest = createHash("sha256").update(JSON.stringify(request.messages)).digest("hex").slice(0, 16);
    const proposals = last.includes("PROPOSE harness.echo")
      ? [{ capability: "harness.echo" as CapabilityId, arguments: { text: last } }]
      : [];
    return this.#response(request, `fake:${digest}`, proposals, proposals.length ? "tool_proposal" : "stop");
  }

  async *stream(
    request: ModelRequest,
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<ModelStreamEvent> {
    const r = await this.generate(request, options);
    for (const chunk of r.content.match(/.{1,8}/g) ?? []) yield { type: "text_delta", text: chunk };
    for (const proposal of r.tool_proposals) yield { type: "tool_proposal", proposal };
    yield { type: "usage", usage: r.usage };
    yield { type: "done", finish_reason: r.finish_reason };
  }

  #response(
    request: ModelRequest,
    content: string,
    tool_proposals: ModelResponse["tool_proposals"],
    finish_reason: ModelResponse["finish_reason"],
  ): ModelResponse {
    const input_tokens = request.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0);
    return {
      schema_version: 1,
      model_id: request.model_id,
      content,
      tool_proposals,
      usage: { input_tokens, output_tokens: Math.ceil(content.length / 4), cost_micro_usd: 0 },
      finish_reason,
    };
  }
}

const EchoInput = z.strictObject({ text: z.string().max(10_000) });
const EchoOutput = z.strictObject({ text: z.string() });

/** Harmless deterministic capability proving the registry boundary; no I/O of any kind. */
export const echoCapability: CapabilityImplementation<
  z.infer<typeof EchoInput>,
  z.infer<typeof EchoOutput>
> = {
  descriptor: {
    id: "harness.echo" as CapabilityId,
    version: "1.0.0",
    description: "Returns its input text unchanged.",
    input_schema: JSON.parse(JSON.stringify(z.toJSONSchema(EchoInput))) as JsonObject,
    output_schema: JSON.parse(JSON.stringify(z.toJSONSchema(EchoOutput))) as JsonObject,
    required_permissions: [],
    side_effect_class: "none",
    timeout_ms: 1_000,
    cancellation: "cooperative",
    audit: { emit_events: true, evidence: "summary" },
    source: { kind: "builtin", ref: "@harness/testing" },
  },
  input: EchoInput,
  output: EchoOutput,
  handler: async ({ text }) => ({ text }),
};
