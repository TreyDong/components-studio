/**
 * notice.show Handler（《运行时与 SDK 协议 v1》第 8.3、8.6 节）。
 * 无能力要求。文本是纯文本，不渲染 HTML。
 */
import type { ActionDefinition, ActionHandler } from "../action-types";
import type { JsonObject } from "@ocs/contracts";
import type { PlatformPort } from "../../platform/ports";
import type { JsonValue, Result } from "@ocs/contracts";
import { baseActionProperties, objectSchema } from "./shared";

interface ShowNoticeInput extends JsonObject {
  message: string;
  level: "info" | "success" | "warning" | "error";
  durationMs: number;
}

export const showNoticeDefinition: ActionDefinition = {
  type: "notice.show",
  currentSpecVersion: 1,
  persistedSchema: objectSchema(
    {
      ...baseActionProperties("notice.show"),
      message: { type: "string" },
      level: { type: "string", enum: ["info", "success", "warning", "error"] },
      durationMs: { type: "integer", minimum: 1000, maximum: 10_000 },
    },
    ["id", "type", "specVersion", "enabled", "label", "when", "resultKey", "timeoutMs", "confirmation", "onError", "extensions", "message", "level", "durationMs"],
  ),
  evaluatedInputSchema: objectSchema(
    {
      message: { type: "string" },
      level: { type: "string", enum: ["info", "success", "warning", "error"] },
      durationMs: { type: "integer", minimum: 1000, maximum: 10_000 },
    },
    ["message", "level", "durationMs"],
  ),
  outputSchema: { type: "null" },
  migrations: [],
  minimumConfirmation: "never",
  requiredCapabilities: () => [],
};

export function createShowNoticeHandler(platform: PlatformPort): ActionHandler {
  return {
    definition: showNoticeDefinition,
    async execute(evaluatedInput: JsonObject): Promise<Result<JsonValue>> {
      const input = evaluatedInput as unknown as ShowNoticeInput;
      platform.notices.show(input.message, {
        level: input.level,
        timeoutMs: input.durationMs,
      });
      return { ok: true, value: null };
    },
  };
}
