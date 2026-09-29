import {
  CapabilityIdSchema,
  HarnessError,
  JsonObjectSchema,
  type ModelId,
  ModelIdSchema,
  TrustLevelSchema,
} from "@harness/contracts";
import { z } from "zod";

/**
 * Model gateway contracts (P00 spec §18). Interfaces only: routing, fallback
 * and real provider adapters are P03. A model can only *propose* tool calls;
 * nothing in this contract lets a model execute a side effect (INV-001), and
 * adapters are replaceable behind it (INV-016).
 */

export const ModelCapabilitiesSchema = z.strictObject({
  model_id: ModelIdSchema,
  modalities: z.array(z.enum(["text", "image", "audio"])).min(1),
  max_context_tokens: z.int().positive(),
  max_output_tokens: z.int().positive(),
  supports_tool_proposals: z.boolean(),
  supports_structured_output: z.boolean(),
  supports_streaming: z.boolean(),
});

/** Every context fragment carries provenance and trust (INV-013, INV-019). */
export const ContextMessageSchema = z.strictObject({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  provenance: z.strictObject({ source: z.string().min(1), trust: TrustLevelSchema }),
});

export const ModelRequestSchema = z.strictObject({
  schema_version: z.literal(1),
  model_id: ModelIdSchema,
  messages: z.array(ContextMessageSchema).min(1),
  tools: z.array(
    z.strictObject({
      capability: CapabilityIdSchema,
      description: z.string(),
      input_schema: JsonObjectSchema,
    }),
  ),
  max_output_tokens: z.int().positive(),
  temperature: z.number().min(0).max(2).optional(),
});

export const ModelUsageSchema = z.strictObject({
  input_tokens: z.int().nonnegative(),
  output_tokens: z.int().nonnegative(),
  cost_micro_usd: z.int().nonnegative().optional(),
});

/** A proposal only. Execution requires policy evaluation and the capability gateway. */
export const ToolCallProposalSchema = z.strictObject({
  capability: CapabilityIdSchema,
  arguments: JsonObjectSchema,
});

export const ModelResponseSchema = z.strictObject({
  schema_version: z.literal(1),
  model_id: ModelIdSchema,
  content: z.string(),
  tool_proposals: z.array(ToolCallProposalSchema),
  usage: ModelUsageSchema,
  finish_reason: z.enum(["stop", "length", "tool_proposal", "cancelled", "error"]),
});

export const ModelStreamEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text_delta"), text: z.string() }),
  z.strictObject({ type: z.literal("tool_proposal"), proposal: ToolCallProposalSchema }),
  z.strictObject({ type: z.literal("usage"), usage: ModelUsageSchema }),
  z.strictObject({ type: z.literal("done"), finish_reason: ModelResponseSchema.shape.finish_reason }),
]);

export const ModelErrorCodes = [
  "RATE_LIMITED",
  "CONTEXT_OVERFLOW",
  "PROVIDER_UNAVAILABLE",
  "INVALID_REQUEST",
  "CANCELLED",
  "UNKNOWN",
] as const;
export const ModelErrorSchema = z.strictObject({
  code: z.enum(ModelErrorCodes),
  message: z.string(),
  retryable: z.boolean(),
});

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;
export type ModelRequest = z.infer<typeof ModelRequestSchema>;
export type ModelResponse = z.infer<typeof ModelResponseSchema>;
export type ModelStreamEvent = z.infer<typeof ModelStreamEventSchema>;
export type ModelUsage = z.infer<typeof ModelUsageSchema>;
export type ModelError = z.infer<typeof ModelErrorSchema>;
export type ToolCallProposal = z.infer<typeof ToolCallProposalSchema>;

/** Provider adapter port. Has no method that performs side effects on the model's behalf. */
export interface ModelAdapter {
  readonly capabilities: ModelCapabilities;
  generate(request: ModelRequest, options?: { signal?: AbortSignal }): Promise<ModelResponse>;
  stream(request: ModelRequest, options?: { signal?: AbortSignal }): AsyncIterable<ModelStreamEvent>;
}

/** Registry of available adapters. Selection/routing policy is P03. */
export class ModelRegistry {
  readonly #adapters = new Map<ModelId, ModelAdapter>();

  register(adapter: ModelAdapter): void {
    const caps = ModelCapabilitiesSchema.parse(adapter.capabilities);
    if (this.#adapters.has(caps.model_id)) {
      throw new HarnessError("DUPLICATE_ID", `model ${caps.model_id} already registered`);
    }
    this.#adapters.set(caps.model_id, adapter);
  }

  get(modelId: ModelId): ModelAdapter {
    const adapter = this.#adapters.get(modelId);
    if (adapter === undefined) throw new HarnessError("INVALID_REFERENCE", `unknown model ${modelId}`);
    return adapter;
  }

  list(): ModelCapabilities[] {
    return [...this.#adapters.values()].map((a) => a.capabilities);
  }
}
