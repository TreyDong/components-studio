/**
 * Event 与 Action 协议（《运行时与 SDK 协议 v1》第 7–8 章）。
 * 持久字段在 contracts/document（ActionSpecV1）；本文件是运行期泛型视图。
 */

import type {
  ActionId,
  ComponentType,
  JsonObject,
  JsonValue,
  NamespacedKey,
  ProtocolError,
  Result,
} from "@ocs/contracts";
import type { Capability } from "./capability-types";
import type { RuntimeMode } from "./types";

export type ActionType =
  | "file.open"
  | "url.open"
  | "command.execute"
  | "file.create"
  | "frontmatter.update"
  | "markdown.task.update"
  | "clipboard.copy"
  | "notice.show";

export interface ConfirmationSpec {
  readonly mode: "never" | "if-untrusted" | "always";
  readonly title: string | null;
  readonly message: string | null;
  readonly confirmLabel: string | null;
  readonly cancelLabel: string | null;
  readonly danger: boolean;
}

export interface BaseActionSpec {
  readonly id: ActionId;
  readonly type: ActionType;
  readonly specVersion: number;
  readonly enabled: boolean;
  readonly label: string | null;
  readonly when: import("@ocs/contracts/document").ExprV1 | null;
  readonly resultKey: string | null;
  readonly timeoutMs: number;
  readonly confirmation: ConfirmationSpec;
  readonly onError: "stop" | "continue";
  readonly extensions: Record<NamespacedKey, JsonValue>;
}

export interface OpenFileAction extends BaseActionSpec {
  readonly type: "file.open";
  readonly path: import("@ocs/contracts/document").ExprV1;
  readonly disposition: "current-tab" | "new-tab" | "split";
  readonly line: import("@ocs/contracts/document").ExprV1 | null;
  readonly column: import("@ocs/contracts/document").ExprV1 | null;
}

export interface OpenUrlAction extends BaseActionSpec {
  readonly type: "url.open";
  readonly url: import("@ocs/contracts/document").ExprV1;
}

export interface ExecuteCommandAction extends BaseActionSpec {
  readonly type: "command.execute";
  readonly commandId: import("@ocs/contracts/document").ExprV1;
}

export interface CreateFileAction extends BaseActionSpec {
  readonly type: "file.create";
  readonly path: import("@ocs/contracts/document").ExprV1;
  readonly content: import("@ocs/contracts/document").ExprV1;
  readonly createParents: boolean;
  readonly ifExists: "error" | "open-existing" | "append-number";
  readonly openAfterCreate: boolean;
}

export type FrontmatterPatchSpec =
  | {
      readonly op: "set";
      readonly key: import("@ocs/contracts/document").ExprV1;
      readonly value: import("@ocs/contracts/document").ExprV1;
    }
  | { readonly op: "delete"; readonly key: import("@ocs/contracts/document").ExprV1 }
  | {
      readonly op: "append";
      readonly key: import("@ocs/contracts/document").ExprV1;
      readonly value: import("@ocs/contracts/document").ExprV1;
      readonly unique: boolean;
    };

export interface UpdateFrontmatterAction extends BaseActionSpec {
  readonly type: "frontmatter.update";
  readonly path: import("@ocs/contracts/document").ExprV1;
  readonly patches: readonly FrontmatterPatchSpec[];
}

export interface MarkdownTaskLocatorSpec {
  readonly path: import("@ocs/contracts/document").ExprV1;
  readonly expectedRawHash: import("@ocs/contracts/document").ExprV1;
  readonly line: import("@ocs/contracts/document").ExprV1;
  readonly expectedLineText: import("@ocs/contracts/document").ExprV1;
  readonly expectedStatus: import("@ocs/contracts/document").ExprV1;
  readonly blockId: import("@ocs/contracts/document").ExprV1 | null;
}

export interface UpdateMarkdownTaskAction extends BaseActionSpec {
  readonly type: "markdown.task.update";
  readonly locator: MarkdownTaskLocatorSpec;
  readonly nextStatus: import("@ocs/contracts/document").ExprV1;
}

export interface CopyTextAction extends BaseActionSpec {
  readonly type: "clipboard.copy";
  readonly text: import("@ocs/contracts/document").ExprV1;
  readonly successMessage: import("@ocs/contracts/document").ExprV1 | null;
}

export interface ShowNoticeAction extends BaseActionSpec {
  readonly type: "notice.show";
  readonly message: import("@ocs/contracts/document").ExprV1;
  readonly level: "info" | "success" | "warning" | "error";
  readonly durationMs: number;
}

export type ActionSpec =
  | OpenFileAction
  | OpenUrlAction
  | ExecuteCommandAction
  | CreateFileAction
  | UpdateFrontmatterAction
  | UpdateMarkdownTaskAction
  | CopyTextAction
  | ShowNoticeAction;

export interface EventSequence {
  readonly concurrency: "drop" | "restart" | "queue";
  readonly maxQueue: number;
  readonly preventDefault: boolean;
  readonly stopPropagation: boolean;
  readonly actions: readonly ActionSpec[];
}

export interface VerifiedActionTrigger {
  readonly __opaqueVerifiedTrigger: unique symbol;
  readonly kind: "pointer" | "keyboard";
  readonly timestampMs: number;
  readonly hostId: string;
}

export interface ActionTrigger {
  readonly kind: "pointer" | "keyboard" | "command" | "system";
  readonly timestampMs: number;
  readonly verifiedGesture?: VerifiedActionTrigger;
}

export interface ComponentEvent {
  readonly eventName: string;
  readonly component: import("./types").ComponentIdentity;
  readonly payload: JsonObject;
  readonly trigger: ActionTrigger;
  readonly mode: RuntimeMode;
  readonly control: {
    preventDefault(): void;
    stopPropagation(): void;
  };
}

export interface EventDispatcher {
  emit(event: ComponentEvent): Promise<ActionSequenceResult>;
}

export interface ActionExecutionResult {
  readonly actionId: ActionId;
  readonly status: "success" | "failed" | "cancelled" | "skipped";
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly output?: JsonValue;
  readonly error?: ProtocolError;
}

export interface ActionSequenceResult {
  readonly status: "success" | "partial" | "failed" | "cancelled";
  readonly results: readonly ActionExecutionResult[];
}

export interface ActionContext {
  readonly component: import("./types").ComponentIdentity;
  readonly sourcePath: string;
  readonly componentProps: JsonObject;
  readonly eventPayload: JsonObject;
  readonly priorOutputs: Readonly<Record<string, JsonValue>>;
  readonly trigger: ActionTrigger;
  readonly mode: RuntimeMode;
  readonly signal: AbortSignal;
}

export interface ActionDefinition {
  readonly type: ActionType;
  readonly currentSpecVersion: number;
  readonly persistedSchema: import("../schema/validator").JsonObjectSchema;
  readonly evaluatedInputSchema: import("../schema/validator").JsonObjectSchema;
  readonly outputSchema: import("../schema/validator").JsonSchema;
  readonly migrations: readonly import("@ocs/contracts/document").ActionMigrationV1[];
  readonly minimumConfirmation: ConfirmationSpec["mode"];
  requiredCapabilities(evaluatedInput: JsonObject): readonly Capability[];
}

export type ActionResolution =
  | { readonly kind: "known"; readonly definition: ActionDefinition }
  | { readonly kind: "unknown"; readonly type: string }
  | {
      readonly kind: "future";
      readonly definition: ActionDefinition;
      readonly fileSpecVersion: number;
      readonly supportedSpecVersion: number;
    };

export interface ActionRegistry {
  register(definition: ActionDefinition): Result<import("@ocs/contracts").Disposable>;
  resolve(type: string, specVersion: number): Result<ActionResolution>;
}

export interface ActionHandler {
  readonly definition: ActionDefinition;
  execute(
    evaluatedInput: JsonObject,
    context: ActionContext,
  ): Promise<Result<JsonValue>>;
}

export interface ActionRunner {
  register(handler: ActionHandler): Result<import("@ocs/contracts").Disposable>;
  run(input: {
    readonly actions: readonly ActionSpec[];
    readonly context: Omit<ActionContext, "signal" | "priorOutputs">;
    readonly signal?: AbortSignal;
  }): Promise<ActionSequenceResult>;
}

export type { ComponentType };
