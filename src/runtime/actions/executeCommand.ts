/**
 * command.execute Handler（《运行时与 SDK 协议 v1》第 8.3、8.6 节）。
 * 能力：command:execute（allowlist 或首次确认由 CapabilityBroker 处理）。
 */
import type { ActionDefinition, ActionHandler } from "../action-types";
import type { JsonObject } from "@ocs/contracts";
import type { PlatformPort } from "../../platform/ports";
import type { JsonValue, Result } from "@ocs/contracts";
import { baseActionProperties, objectSchema } from "./shared";

interface ExecuteCommandInput extends JsonObject {
  commandId: string;
}

export const executeCommandDefinition: ActionDefinition = {
  type: "command.execute",
  currentSpecVersion: 1,
  persistedSchema: objectSchema(
    {
      ...baseActionProperties("command.execute"),
      commandId: { type: "string" },
    },
    ["id", "type", "specVersion", "enabled", "label", "when", "resultKey", "timeoutMs", "confirmation", "onError", "extensions", "commandId"],
  ),
  evaluatedInputSchema: objectSchema({ commandId: { type: "string" } }, ["commandId"]),
  outputSchema: { type: "null" },
  migrations: [],
  minimumConfirmation: "never",
  requiredCapabilities: () => ["command:execute"],
};

export function createExecuteCommandHandler(platform: PlatformPort): ActionHandler {
  return {
    definition: executeCommandDefinition,
    async execute(evaluatedInput: JsonObject): Promise<Result<JsonValue>> {
      const input = evaluatedInput as unknown as ExecuteCommandInput;
      const r = await platform.commands.execute(input.commandId);
      if (!r.ok) return r;
      return { ok: true, value: null };
    },
  };
}
