/**
 * markdown.task.update Handler（《运行时与 SDK 协议 v1》第 8.3、8.6 节）。
 * 能力：vault:read + vault:modify。CAS 定位器由文档生成，外部变化返回 conflict。
 */
import type { ActionDefinition, ActionHandler } from "../action-types";
import type { JsonObject } from "@ocs/contracts";
import type { PlatformPort } from "../../platform/ports";
import type { JsonValue, Result } from "@ocs/contracts";
import { baseActionProperties, objectSchema, nullable } from "./shared";

const locatorSchema = objectSchema(
  {
    path: { type: "string" },
    expectedRawHash: { type: "string" },
    line: { type: "integer" },
    expectedLineText: { type: "string" },
    expectedStatus: { type: "string" },
    blockId: nullable({ type: "string" }),
  },
  ["path", "expectedRawHash", "line", "expectedLineText", "expectedStatus", "blockId"],
);

interface MarkdownTaskLocatorInput extends JsonObject {
  path: string;
  expectedRawHash: string;
  line: number;
  expectedLineText: string;
  expectedStatus: string;
  blockId: string | null;
}

interface UpdateMarkdownTaskInput extends JsonObject {
  locator: MarkdownTaskLocatorInput;
  nextStatus: string;
}

export const updateMarkdownTaskDefinition: ActionDefinition = {
  type: "markdown.task.update",
  currentSpecVersion: 1,
  persistedSchema: objectSchema(
    {
      ...baseActionProperties("markdown.task.update"),
      locator: locatorSchema,
      nextStatus: { type: "string" },
    },
    ["id", "type", "specVersion", "enabled", "label", "when", "resultKey", "timeoutMs", "confirmation", "onError", "extensions", "locator", "nextStatus"],
  ),
  evaluatedInputSchema: objectSchema(
    {
      locator: locatorSchema,
      nextStatus: { type: "string" },
    },
    ["locator", "nextStatus"],
  ),
  outputSchema: { type: "null" },
  migrations: [],
  minimumConfirmation: "never",
  requiredCapabilities: () => ["vault:read", "vault:modify"],
};

export function createUpdateMarkdownTaskHandler(platform: PlatformPort): ActionHandler {
  return {
    definition: updateMarkdownTaskDefinition,
    async execute(evaluatedInput: JsonObject): Promise<Result<JsonValue>> {
      const input = evaluatedInput as unknown as UpdateMarkdownTaskInput;
      const r = await platform.vaultMutation.updateMarkdownTask({
        locator: {
          path: input.locator.path,
          expectedRawHash: input.locator.expectedRawHash,
          line: input.locator.line,
          expectedLineText: input.locator.expectedLineText,
          expectedStatus: input.locator.expectedStatus,
          blockId: input.locator.blockId,
        },
        nextStatus: input.nextStatus,
      });
      if (!r.ok) return r;
      return { ok: true, value: null };
    },
  };
}
