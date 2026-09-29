import {
  type CapabilityId,
  CapabilityIdSchema,
  HarnessError,
  type JsonObject,
  JsonObjectSchema,
  ProducerSchema,
  SideEffectClassSchema,
  TraceIdSchema,
} from "@harness/contracts";
import { z } from "zod";

/**
 * Capability/tool contracts (P00 spec §19). Every tool declares identity,
 * typed I/O, permissions, side-effect class, timeout/cancellation and audit
 * behaviour. The P00 registry proves the boundary with harmless tools only:
 * it refuses anything whose side-effect class is not "none".
 */

export const CapabilityDescriptorSchema = z.strictObject({
  id: CapabilityIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  input_schema: JsonObjectSchema,
  output_schema: JsonObjectSchema,
  required_permissions: z.array(z.string().regex(/^[a-z][a-z0-9_.:-]*$/)),
  side_effect_class: SideEffectClassSchema,
  timeout_ms: z.int().positive().max(600_000),
  cancellation: z.enum(["cooperative", "not_supported"]),
  audit: z.strictObject({ emit_events: z.boolean(), evidence: z.enum(["none", "summary", "full"]) }),
  source: z.strictObject({ kind: z.enum(["builtin", "plugin", "mcp", "a2a"]), ref: z.string().min(1) }),
});

/** What a model is shown about a tool: never permissions or handlers. */
export const ToolSchemaSchema = z.strictObject({
  capability: CapabilityIdSchema,
  description: z.string(),
  input_schema: JsonObjectSchema,
});

export const ToolRequestSchema = z.strictObject({
  schema_version: z.literal(1),
  capability: CapabilityIdSchema,
  arguments: JsonObjectSchema,
  caller: ProducerSchema,
  trace_id: TraceIdSchema,
});

export const ToolErrorCodes = [
  "UNKNOWN_CAPABILITY",
  "INVALID_INPUT",
  "INVALID_OUTPUT",
  "TIMEOUT",
  "CANCELLED",
  "HANDLER_FAILED",
] as const;

export const ToolResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), output: JsonObjectSchema, duration_ms: z.number().nonnegative() }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({ code: z.enum(ToolErrorCodes), message: z.string() }),
    duration_ms: z.number().nonnegative(),
  }),
]);

export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptorSchema>;
export type ToolSchema = z.infer<typeof ToolSchemaSchema>;
export type ToolRequest = z.infer<typeof ToolRequestSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ToolError = Extract<ToolResult, { ok: false }>["error"];

export interface CapabilityImplementation<I extends JsonObject, O extends JsonObject> {
  descriptor: CapabilityDescriptor;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  handler: (input: I, ctx: { signal: AbortSignal }) => Promise<O>;
}

/**
 * P00 capability registry. Registration of a duplicate ID fails; invocation of
 * an unregistered capability fails closed; inputs and outputs are validated.
 * Policy evaluation before invocation is P06; the full gateway is P05.
 */
export class CapabilityRegistry {
  readonly #entries = new Map<CapabilityId, CapabilityImplementation<JsonObject, JsonObject>>();

  register<I extends JsonObject, O extends JsonObject>(impl: CapabilityImplementation<I, O>): void {
    const descriptor = CapabilityDescriptorSchema.parse(impl.descriptor);
    if (this.#entries.has(descriptor.id)) {
      throw new HarnessError("DUPLICATE_ID", `capability ${descriptor.id} already registered`, {
        details: { capability: descriptor.id },
      });
    }
    if (descriptor.side_effect_class !== "none") {
      throw new HarnessError(
        "PAYLOAD_INVALID",
        "the P00 registry only accepts side-effect-free capabilities",
        {
          details: { capability: descriptor.id, side_effect_class: descriptor.side_effect_class },
        },
      );
    }
    this.#entries.set(descriptor.id, impl as unknown as CapabilityImplementation<JsonObject, JsonObject>);
  }

  describe(): ToolSchema[] {
    return [...this.#entries.values()].map((e) => ({
      capability: e.descriptor.id,
      description: e.descriptor.description,
      input_schema: e.descriptor.input_schema,
    }));
  }

  has(id: CapabilityId): boolean {
    return this.#entries.has(id);
  }

  async invoke(request: ToolRequest): Promise<ToolResult> {
    const started = performance.now();
    const elapsed = () => performance.now() - started;
    const fail = (code: ToolError["code"], message: string): ToolResult => ({
      ok: false,
      error: { code, message },
      duration_ms: elapsed(),
    });
    const req = ToolRequestSchema.safeParse(request);
    if (!req.success) return fail("INVALID_INPUT", "invalid tool request");
    const entry = this.#entries.get(req.data.capability);
    if (entry === undefined)
      return fail("UNKNOWN_CAPABILITY", `capability ${req.data.capability} is not registered`);
    const input = entry.input.safeParse(req.data.arguments);
    if (!input.success) return fail("INVALID_INPUT", "arguments do not match the capability input schema");

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, entry.descriptor.timeout_ms);
    });
    try {
      const outcome = await Promise.race([entry.handler(input.data, { signal: controller.signal }), timeout]);
      if (outcome === "timeout")
        return fail("TIMEOUT", `capability exceeded ${entry.descriptor.timeout_ms}ms`);
      const output = entry.output.safeParse(outcome);
      if (!output.success) return fail("INVALID_OUTPUT", "capability returned output outside its schema");
      return { ok: true, output: output.data, duration_ms: elapsed() };
    } catch (error) {
      return fail("HANDLER_FAILED", error instanceof Error ? error.message : "handler failed");
    } finally {
      clearTimeout(timer);
    }
  }
}
