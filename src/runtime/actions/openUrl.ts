/**
 * url.open Handler（《运行时与 SDK 协议 v1》第 8.3、8.6 节）。
 * 能力：external-url:open。只允许 http/https；javascript:/data:/file: 拒绝。
 */
import type { ActionDefinition, ActionHandler } from "../action-types";
import type { JsonObject } from "@ocs/contracts";
import type { PlatformPort } from "../../platform/ports";
import type { JsonValue, Result } from "@ocs/contracts";
import { baseActionProperties, objectSchema, actionError } from "./shared";
import { ERROR_CODES } from "@ocs/contracts";

const HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;

interface OpenUrlInput extends JsonObject {
  url: string;
}

export const openUrlDefinition: ActionDefinition = {
  type: "url.open",
  currentSpecVersion: 1,
  persistedSchema: objectSchema(
    {
      ...baseActionProperties("url.open"),
      url: { type: "string", format: "uri-http" },
    },
    ["id", "type", "specVersion", "enabled", "label", "when", "resultKey", "timeoutMs", "confirmation", "onError", "extensions", "url"],
  ),
  evaluatedInputSchema: objectSchema({ url: { type: "string" } }, ["url"]),
  outputSchema: { type: "null" },
  migrations: [],
  minimumConfirmation: "never",
  requiredCapabilities: () => ["external-url:open"],
};

export function createOpenUrlHandler(platform: PlatformPort): ActionHandler {
  return {
    definition: openUrlDefinition,
    async execute(evaluatedInput: JsonObject): Promise<Result<JsonValue>> {
      const input = evaluatedInput as unknown as OpenUrlInput;
      if (!HTTP_URL_PATTERN.test(input.url)) {
        return {
          ok: false,
          error: actionError(
            ERROR_CODES.ACTION_URL_SCHEME_DENIED,
            `URL scheme 被拒绝（只允许 http/https）: ${input.url}`,
          ),
        };
      }
      const r = await platform.externalUrls.open(input.url);
      if (!r.ok) return r;
      return { ok: true, value: null };
    },
  };
}
