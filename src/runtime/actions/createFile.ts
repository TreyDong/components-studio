/**
 * file.create Handler（《运行时与 SDK 协议 v1》第 8.3、8.6 节）。
 * 能力：vault:create；openAfterCreate=true 时再加 workspace:navigate。
 * 永不覆盖已有文件（ifExists 由 VaultMutationPort 保证）。
 */
import type { ActionDefinition, ActionHandler } from "../action-types";
import type { JsonObject } from "@ocs/contracts";
import type { PlatformPort } from "../../platform/ports";
import type { JsonValue, Result } from "@ocs/contracts";
import { baseActionProperties, objectSchema } from "./shared";

interface CreateFileInput extends JsonObject {
  path: string;
  content: string;
  createParents: boolean;
  ifExists: "error" | "open-existing" | "append-number";
  openAfterCreate: boolean;
}

export const createFileDefinition: ActionDefinition = {
  type: "file.create",
  currentSpecVersion: 1,
  persistedSchema: objectSchema(
    {
      ...baseActionProperties("file.create"),
      path: { type: "string", format: "vault-path" },
      content: { type: "string" },
      createParents: { type: "boolean" },
      ifExists: { type: "string", enum: ["error", "open-existing", "append-number"] },
      openAfterCreate: { type: "boolean" },
    },
    ["id", "type", "specVersion", "enabled", "label", "when", "resultKey", "timeoutMs", "confirmation", "onError", "extensions", "path", "content", "createParents", "ifExists", "openAfterCreate"],
  ),
  evaluatedInputSchema: objectSchema(
    {
      path: { type: "string" },
      content: { type: "string" },
      createParents: { type: "boolean" },
      ifExists: { type: "string", enum: ["error", "open-existing", "append-number"] },
      openAfterCreate: { type: "boolean" },
    },
    ["path", "content", "createParents", "ifExists", "openAfterCreate"],
  ),
  outputSchema: { type: "null" },
  migrations: [],
  minimumConfirmation: "never",
  requiredCapabilities: (input: JsonObject) =>
    input.openAfterCreate === true
      ? ["vault:create", "workspace:navigate"]
      : ["vault:create"],
};

export function createCreateFileHandler(platform: PlatformPort): ActionHandler {
  return {
    definition: createFileDefinition,
    async execute(evaluatedInput: JsonObject): Promise<Result<JsonValue>> {
      const input = evaluatedInput as unknown as CreateFileInput;
      const created = await platform.vaultMutation.createText({
        path: input.path,
        text: input.content,
        createParents: input.createParents,
        ifExists: input.ifExists,
      });
      if (!created.ok) return created;
      if (input.openAfterCreate) {
        const open = await platform.workspace.openFile(input.path, {
          disposition: "current-tab",
        });
        if (!open.ok) return open;
      }
      return { ok: true, value: null };
    },
  };
}
