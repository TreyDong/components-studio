/**
 * file.open Handler（《运行时与 SDK 协议 v1》第 8.3、8.6 节）。
 * 能力：workspace:navigate。
 */
import type { ActionDefinition, ActionHandler } from "../action-types";
import type { JsonObject } from "@ocs/contracts";
import type { PlatformPort } from "../../platform/ports";
import type { JsonValue, Result } from "@ocs/contracts";
import { baseActionProperties, objectSchema } from "./shared";

import { nullable } from "./shared";

interface OpenFileInput extends JsonObject {
  path: string;
  disposition: "current-tab" | "new-tab" | "split";
  line: number | null;
  column: number | null;
}

export const openFileDefinition: ActionDefinition = {
  type: "file.open",
  currentSpecVersion: 1,
  persistedSchema: objectSchema(
    {
      ...baseActionProperties("file.open"),
      path: { type: "string", format: "vault-path" },
      disposition: { type: "string", enum: ["current-tab", "new-tab", "split"] },
      line: nullable({ type: "integer" }),
      column: nullable({ type: "integer" }),
    },
    ["id", "type", "specVersion", "enabled", "label", "when", "resultKey", "timeoutMs", "confirmation", "onError", "extensions", "path", "disposition", "line", "column"],
  ),
  evaluatedInputSchema: objectSchema(
    {
      path: { type: "string" },
      disposition: { type: "string", enum: ["current-tab", "new-tab", "split"] },
      line: nullable({ type: "integer" }),
      column: nullable({ type: "integer" }),
    },
    ["path", "disposition", "line", "column"],
  ),
  outputSchema: { type: "null" },
  migrations: [],
  minimumConfirmation: "never",
  requiredCapabilities: () => ["workspace:navigate"],
};

export function createOpenFileHandler(platform: PlatformPort): ActionHandler {
  return {
    definition: openFileDefinition,
    async execute(evaluatedInput: JsonObject): Promise<Result<JsonValue>> {
      const input = evaluatedInput as unknown as OpenFileInput;
      const r = await platform.workspace.openFile(input.path, {
        disposition: input.disposition,
        ...(input.line !== null ? { line: input.line } : {}),
        ...(input.column !== null ? { column: input.column } : {}),
      });
      if (!r.ok) return r;
      return { ok: true, value: null };
    },
  };
}
