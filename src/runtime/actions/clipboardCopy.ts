/**
 * clipboard.copy Handler（《运行时与 SDK 协议 v1》第 8.3、8.6 节）。
 * 能力：clipboard:write。成功后可选展示 successMessage 通知。
 */
import type { ActionDefinition, ActionHandler } from "../action-types";
import type { JsonObject } from "@ocs/contracts";
import type { PlatformPort } from "../../platform/ports";
import type { JsonValue, Result } from "@ocs/contracts";
import { baseActionProperties, objectSchema, nullable } from "./shared";

interface CopyTextInput extends JsonObject {
  text: string;
  successMessage: string | null;
}

export const clipboardCopyDefinition: ActionDefinition = {
  type: "clipboard.copy",
  currentSpecVersion: 1,
  persistedSchema: objectSchema(
    {
      ...baseActionProperties("clipboard.copy"),
      text: { type: "string" },
      successMessage: nullable({ type: "string" }),
    },
    ["id", "type", "specVersion", "enabled", "label", "when", "resultKey", "timeoutMs", "confirmation", "onError", "extensions", "text", "successMessage"],
  ),
  evaluatedInputSchema: objectSchema(
    {
      text: { type: "string" },
      successMessage: nullable({ type: "string" }),
    },
    ["text", "successMessage"],
  ),
  outputSchema: { type: "null" },
  migrations: [],
  minimumConfirmation: "never",
  requiredCapabilities: () => ["clipboard:write"],
};

export function createClipboardCopyHandler(platform: PlatformPort): ActionHandler {
  return {
    definition: clipboardCopyDefinition,
    async execute(evaluatedInput: JsonObject): Promise<Result<JsonValue>> {
      const input = evaluatedInput as unknown as CopyTextInput;
      const r = await platform.clipboard.writeText(input.text);
      if (!r.ok) return r;
      if (input.successMessage !== null) {
        platform.notices.show(input.successMessage, { level: "success" });
      }
      return { ok: true, value: null };
    },
  };
}
