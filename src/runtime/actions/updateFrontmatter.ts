/**
 * frontmatter.update Handler（《运行时与 SDK 协议 v1》第 8.3、8.6 节）。
 * 能力：vault:read + vault:modify。CAS：先读当前文本作为 expectedFileText。
 */
import type { ActionDefinition, ActionHandler } from "../action-types";
import type { JsonObject } from "@ocs/contracts";
import type { FrontmatterPatchOperation, PlatformPort } from "../../platform/ports";
import type { JsonValue, Result } from "@ocs/contracts";
import { anyJsonLoose, baseActionProperties, objectSchema } from "./shared";

const patchSchema = {
  oneOf: [
    {
      type: "object",
      properties: { op: { type: "string", enum: ["set"] }, key: { type: "string" }, value: anyJsonLoose },
      required: ["op", "key", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { op: { type: "string", enum: ["delete"] }, key: { type: "string" } },
      required: ["op", "key"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["append"] },
        key: { type: "string" },
        value: anyJsonLoose,
        unique: { type: "boolean" },
      },
      required: ["op", "key", "value", "unique"],
      additionalProperties: false,
    },
  ],
} as const;

interface FrontmatterPatchInput {
  op: "set" | "delete" | "append";
  key: string;
  value?: JsonValue;
  unique?: boolean;
}

interface UpdateFrontmatterInput {
  path: string;
  patches: readonly FrontmatterPatchInput[];
}

export const updateFrontmatterDefinition: ActionDefinition = {
  type: "frontmatter.update",
  currentSpecVersion: 1,
  persistedSchema: objectSchema(
    {
      ...baseActionProperties("frontmatter.update"),
      path: { type: "string", format: "vault-path" },
      patches: { type: "array", items: patchSchema },
    },
    ["id", "type", "specVersion", "enabled", "label", "when", "resultKey", "timeoutMs", "confirmation", "onError", "extensions", "path", "patches"],
  ),
  evaluatedInputSchema: objectSchema(
    {
      path: { type: "string" },
      patches: { type: "array", items: patchSchema },
    },
    ["path", "patches"],
  ),
  outputSchema: { type: "null" },
  migrations: [],
  minimumConfirmation: "never",
  requiredCapabilities: () => ["vault:read", "vault:modify"],
};

export function createUpdateFrontmatterHandler(platform: PlatformPort): ActionHandler {
  return {
    definition: updateFrontmatterDefinition,
    async execute(evaluatedInput: JsonObject): Promise<Result<JsonValue>> {
      const input = evaluatedInput as unknown as UpdateFrontmatterInput;
      const read = await platform.vaultRead.readText(input.path);
      if (!read.ok) return read;
      const patch: Record<string, FrontmatterPatchOperation> = {};
      for (const p of input.patches) {
        if (p.op === "set") {
          patch[p.key] = { op: "set", value: p.value ?? null };
        } else if (p.op === "append") {
          patch[p.key] = { op: "append", value: p.value ?? null, unique: p.unique === true };
        } else {
          patch[p.key] = { op: "delete" };
        }
      }
      const r = await platform.vaultMutation.updateFrontmatter({
        path: input.path,
        expectedFileText: read.value.text,
        patch,
      });
      if (!r.ok) return r;
      return { ok: true, value: null };
    },
  };
}

export type { FrontmatterPatchInput };
