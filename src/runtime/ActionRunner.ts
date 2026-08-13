/**
 * ActionRunner（《运行时与 SDK 协议 v1》第 8.4–8.5 节）。
 *
 * 固定执行顺序：
 *   数量/ID/resultKey 校验 → Definition 解析 → enabled/when → 按 Discriminator
 *   求值 Expr 字段 → evaluatedInputSchema 校验 → requiredCapabilities →
 *   CapabilityBroker.evaluate/requestGrant → confirmation 合并 →
 *   创建 timeout + AbortSignal → 串行执行 Handler → outputSchema 校验 →
 *   resultKey 写入 priorOutputs → 按 onError 停止或继续 → 汇总状态。
 */
import type {
  ActionContext,
  ActionDefinition,
  ActionExecutionResult,
  ActionHandler,
  ActionResolution,
  ActionRunner as ActionRunnerPort,
  ActionSequenceResult,
  ActionSpec,
  ConfirmationSpec,
} from "./action-types";
import type {
  Capability,
  CapabilityBroker,
  CapabilitySubject,
} from "./capability-types";
import type { DiagnosticPort } from "./types";
import type { ClockPort, CommandPort, ConfirmationPort } from "../platform/ports";
import type {
  Disposable,
  ActionId,
  ErrorCode,
  JsonObject,
  JsonValue,
  ProtocolError,
  Result,
  ValidationIssue,
  VaultId,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import type { ExprV1 } from "@ocs/contracts/document";
import { evaluateExpr, jsonValueEqual } from "./expr";
import { validateAgainstSchema } from "../schema/validator";
import type { JsonObjectSchema, JsonSchema } from "../schema/validator";

export const MAX_ACTIONS_PER_SEQUENCE = 100;

export interface ActionRunnerOptions {
  readonly capabilities: CapabilityBroker;
  readonly confirmations: ConfirmationPort;
  readonly clock: ClockPort;
  readonly commands: CommandPort;
  readonly diagnostics: DiagnosticPort;
  readonly vaultId: VaultId;
}

/** preview 模式下每次执行仍需确认的“写”能力（协议 3.8）。 */
const PREVIEW_REQUIRES_CONFIRM: ReadonlySet<Capability> = new Set<Capability>([
  "vault:create",
  "vault:modify",
  "command:execute",
  "external-url:open",
  "clipboard:write",
]);

const CONFIRMATION_ORDER: Record<ConfirmationSpec["mode"], number> = {
  never: 0,
  "if-untrusted": 1,
  always: 2,
};

function maxConfirmation(a: ConfirmationSpec["mode"], b: ConfirmationSpec["mode"]): ConfirmationSpec["mode"] {
  return CONFIRMATION_ORDER[a] >= CONFIRMATION_ORDER[b] ? a : b;
}

function actionError(
  code: ErrorCode,
  message: string,
  details?: JsonObject,
): ProtocolError {
  return {
    code,
    message,
    scope: "action",
    recoverable: false,
    retryable: false,
    ...(details ? { details } : {}),
  };
}

export class ActionRunner implements ActionRunnerPort {
  private readonly handlers = new Map<string, ActionHandler>();
  private readonly options: ActionRunnerOptions;

  constructor(options: ActionRunnerOptions) {
    this.options = options;
  }

  register(handler: ActionHandler): Result<Disposable> {
    if (this.handlers.has(handler.definition.type)) {
      return {
        ok: false,
        error: actionError(
          ERROR_CODES.REGISTRY_TYPE_CONFLICT,
          `Action type 已注册: ${handler.definition.type}`,
        ),
      };
    }
    this.handlers.set(handler.definition.type, handler);
    let active = true;
    return {
      ok: true,
      value: {
        dispose: () => {
          if (active && this.handlers.get(handler.definition.type) === handler) {
            active = false;
            this.handlers.delete(handler.definition.type);
          }
        },
      },
    };
  }

  resolve(type: string, specVersion: number): Result<ActionResolution> {
    const handler = this.handlers.get(type);
    if (!handler) {
      return { ok: true, value: { kind: "unknown", type } };
    }
    if (specVersion > handler.definition.currentSpecVersion) {
      return {
        ok: true,
        value: {
          kind: "future",
          definition: handler.definition,
          fileSpecVersion: specVersion,
          supportedSpecVersion: handler.definition.currentSpecVersion,
        },
      };
    }
    return { ok: true, value: { kind: "known", definition: handler.definition } };
  }

  async run(input: {
    readonly actions: readonly ActionSpec[];
    readonly context: Omit<ActionContext, "signal" | "priorOutputs">;
    readonly signal?: AbortSignal;
  }): Promise<ActionSequenceResult> {
    const { actions, context, signal: externalSignal } = input;
    const preflight = this.preflight(actions);
    if (!preflight.ok) {
      return { status: "failed", results: [preflight.error] };
    }
    const priorOutputs: Record<string, JsonValue> = {};
    const results: ActionExecutionResult[] = [];
    for (const action of actions) {
      if (externalSignal?.aborted) {
        results.push(
          this.finished(action.id, "cancelled", actionError(ERROR_CODES.ACTION_CANCELLED, "序列已取消（外部信号）")),
        );
        continue;
      }
      const r = await this.runAction(action, context, priorOutputs, externalSignal);
      results.push(r.result);
      if (r.result.status === "failed" && action.onError === "stop") {
        break;
      }
    }
    return { status: summarizeStatus(results), results };
  }

  private preflight(
    actions: readonly ActionSpec[],
  ): { ok: true } | { ok: false; error: ActionExecutionResult } {
    if (actions.length > MAX_ACTIONS_PER_SEQUENCE) {
      return {
        ok: false,
        error: {
          // 序列级错误无对应 Action；空 ID 仅作为占位（不是文档 ActionId）。
          actionId: "" as ActionId,
          status: "failed",
          startedAtMs: this.options.clock.now(),
          finishedAtMs: this.options.clock.now(),
          error: actionError(
            ERROR_CODES.ACTION_INPUT_INVALID,
            `EventSequence 超过 ${MAX_ACTIONS_PER_SEQUENCE} 个 Action`,
          ),
        },
      };
    }
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    for (const action of actions) {
      if (seenIds.has(action.id)) {
        return {
          ok: false,
          error: {
            actionId: action.id,
            status: "failed",
            startedAtMs: this.options.clock.now(),
            finishedAtMs: this.options.clock.now(),
            error: actionError(ERROR_CODES.ACTION_ID_DUPLICATE, `Action ID 重复: ${action.id}`),
          },
        };
      }
      seenIds.add(action.id);
      if (action.resultKey !== null) {
        if (seenKeys.has(action.resultKey)) {
          return {
            ok: false,
            error: {
              actionId: action.id,
              status: "failed",
              startedAtMs: this.options.clock.now(),
              finishedAtMs: this.options.clock.now(),
              error: actionError(
                ERROR_CODES.ACTION_RESULT_KEY_DUPLICATE,
                `resultKey 重复: ${action.resultKey}`,
              ),
            },
          };
        }
        seenKeys.add(action.resultKey);
      }
    }
    return { ok: true };
  }

  private async runAction(
    action: ActionSpec,
    base: Omit<ActionContext, "signal" | "priorOutputs">,
    priorOutputs: Record<string, JsonValue>,
    externalSignal?: AbortSignal,
  ): Promise<{ result: ActionExecutionResult }> {
    const startedAtMs = this.options.clock.now();
    const fail = (error: ProtocolError): ActionExecutionResult =>
      this.finished(action.id, "failed", error, startedAtMs);
    const skip = (): ActionExecutionResult => ({
      actionId: action.id,
      status: "skipped",
      startedAtMs,
      finishedAtMs: startedAtMs,
    });
    const cancel = (error: ProtocolError): ActionExecutionResult =>
      this.finished(action.id, "cancelled", error, startedAtMs);

    if (!action.enabled) {
      return { result: skip() };
    }
    const resolution = this.resolve(action.type, action.specVersion);
    if (!resolution.ok) {
      return { result: fail(resolution.error) };
    }
    if (resolution.value.kind === "unknown") {
      return {
        result: fail(actionError(ERROR_CODES.ACTION_TYPE_UNKNOWN, `未知 Action type: ${action.type}`)),
      };
    }
    if (resolution.value.kind === "future") {
      return {
        result: fail(
          actionError(
            ERROR_CODES.ACTION_VERSION_FUTURE,
            `Action ${action.type} 文件版本 ${resolution.value.fileSpecVersion} 高于运行时支持版本 ${resolution.value.supportedSpecVersion}`,
          ),
        ),
      };
    }
    const definition = resolution.value.definition;
    if (action.specVersion !== definition.currentSpecVersion) {
      return {
        result: fail(
          actionError(
            ERROR_CODES.ACTION_VERSION_UNSUPPORTED,
            `Action ${action.type} 需要版本 ${definition.currentSpecVersion}，文件为 ${action.specVersion}`,
          ),
        ),
      };
    }
    if (action.timeoutMs < 100 || action.timeoutMs > 60_000) {
      return {
        result: fail(actionError(ERROR_CODES.ACTION_INPUT_INVALID, `timeoutMs 越界: ${action.timeoutMs}`)),
      };
    }

    const exprContext = this.exprContext(base, priorOutputs);
    if (action.when !== null) {
      const when = evaluateExpr(action.when, exprContext);
      if (!when.ok) {
        return { result: fail(actionError(ERROR_CODES.ACTION_INPUT_EVALUATION_FAILED, `when 求值失败`, when.error.details)) };
      }
      if (when.value === false) {
        return { result: skip() };
      }
    }

    const evaluated = this.evaluateFields(action, exprContext);
    if (!evaluated.ok) {
      return { result: fail(actionError(ERROR_CODES.ACTION_INPUT_EVALUATION_FAILED, `Action 字段求值失败`, evaluated.error.details)) };
    }
    const evaluatedInput = evaluated.value;

    const issues: ValidationIssue[] = [];
    validateAgainstSchema(
      evaluatedInput,
      definition.evaluatedInputSchema as JsonObjectSchema,
      {},
      issues,
    );
    if (issues.length > 0) {
      return {
        result: fail(
          actionError(ERROR_CODES.ACTION_INPUT_SCHEMA_INVALID, "evaluatedInput 未通过 evaluatedInputSchema", {
            issues: issues.map((i) => ({
              pointer: i.pointer,
              code: i.code,
              message: i.message,
              severity: i.severity,
            })),
          } satisfies JsonObject),
        ),
      };
    }

    const capabilities = definition.requiredCapabilities(evaluatedInput);
    const subject: CapabilitySubject = {
      vaultId: this.options.vaultId,
      documentId: base.component.documentId,
      componentId: base.component.componentId,
      componentType: base.component.type,
      vendor: base.component.vendor,
      packageVersion: base.component.packageVersion,
    };
    const commandAllowlisted =
      action.type === "command.execute" &&
      typeof evaluatedInput.commandId === "string" &&
      this.options.commands.isAllowlisted(evaluatedInput.commandId);
    for (const capability of capabilities) {
      if (commandAllowlisted && capability === "command:execute") {
        continue; // allowlist 直接允许（策略表 8.1）
      }
      let decision = this.options.capabilities.evaluate(subject, capability, base.mode);
      if (!decision.granted) {
        decision = await this.options.capabilities.requestGrant({
          subject,
          capability,
          reason: `执行动作 ${action.type}`,
          mode: base.mode,
          trigger: base.trigger,
        });
      }
      if (!decision.granted) {
        return {
          result: fail(
            actionError(
              ERROR_CODES.ACTION_CAPABILITY_DENIED,
              `能力 ${capability} 未授权（${decision.source}）：${decision.reason}`,
              { capability, source: decision.source, reason: decision.reason } satisfies JsonObject,
            ),
          ),
        };
      }
    }

    const merged = maxConfirmation(action.confirmation.mode, definition.minimumConfirmation);
    let effective: ConfirmationSpec["mode"] = merged;
    if (
      base.mode === "preview" &&
      capabilities.some((c) => PREVIEW_REQUIRES_CONFIRM.has(c))
    ) {
      effective = "always";
    }
    if (effective === "always") {
      const confirmed = await this.confirm(action);
      if (!confirmed) {
        return {
          result: cancel(actionError(ERROR_CODES.ACTION_CONFIRMATION_REJECTED, "用户取消确认")),
        };
      }
    } else if (effective === "if-untrusted") {
      const untrusted = base.component.vendor !== "components-studio";
      if (untrusted) {
        const confirmed = await this.confirm(action);
        if (!confirmed) {
          return {
            result: cancel(actionError(ERROR_CODES.ACTION_CONFIRMATION_REJECTED, "用户取消确认")),
          };
        }
      }
    }

    const handler = this.handlers.get(action.type);
    if (!handler) {
      return {
        result: fail(actionError(ERROR_CODES.ACTION_TYPE_UNKNOWN, `缺少 Handler: ${action.type}`)),
      };
    }

    // timeout + AbortSignal（协议 8.5）
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        return { result: cancel(actionError(ERROR_CODES.ACTION_CANCELLED, "序列已取消")) };
      }
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timer = this.options.clock.timeout(() => {
      timedOut = true;
      controller.abort();
    }, action.timeoutMs);
    const context: ActionContext = {
      ...base,
      priorOutputs,
      signal: controller.signal,
    };
    let result: Result<JsonValue>;
    try {
      const abortPromise = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
      result = await Promise.race([handler.execute(evaluatedInput, context), abortPromise]);
    } catch {
      timer.dispose();
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
      if (controller.signal.aborted) {
        return {
          result: timedOut
            ? fail(actionError(ERROR_CODES.ACTION_TIMEOUT, `动作超时（${action.timeoutMs}ms）`))
            : cancel(actionError(ERROR_CODES.ACTION_CANCELLED, "动作被取消")),
        };
      }
      return {
        result: fail(actionError(ERROR_CODES.ACTION_EXECUTION_FAILED, "Handler 抛出异常")),
      };
    }
    timer.dispose();
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
    if (controller.signal.aborted) {
      return {
        result: timedOut
          ? fail(actionError(ERROR_CODES.ACTION_TIMEOUT, `动作超时（${action.timeoutMs}ms）`))
          : cancel(actionError(ERROR_CODES.ACTION_CANCELLED, "动作被取消")),
      };
    }
    if (!result.ok) {
      return { result: fail(result.error) };
    }
    const output = result.value;
    const outputIssues: ValidationIssue[] = [];
    validateAgainstSchema(output, definition.outputSchema, {}, outputIssues);
    if (outputIssues.length > 0) {
      return {
        result: fail(
          actionError(
            ERROR_CODES.ACTION_OUTPUT_SCHEMA_INVALID,
            "Handler 输出未通过 outputSchema",
            {
              issues: outputIssues.map((i) => ({
                pointer: i.pointer,
                code: i.code,
                message: i.message,
                severity: i.severity,
              })),
            } satisfies JsonObject,
          ),
        ),
      };
    }
    if (action.resultKey !== null) {
      priorOutputs[action.resultKey] = output;
    }
    return {
      result: {
        actionId: action.id,
        status: "success",
        startedAtMs,
        finishedAtMs: this.options.clock.now(),
        ...(output !== null ? { output } : {}),
      },
    };
  }

  private confirm(action: ActionSpec): Promise<boolean> {
    const c = action.confirmation;
    return this.options.confirmations.confirm({
      title: c.title ?? `确认操作（${action.type}）`,
      message: c.message ?? `是否执行 ${action.type}？`,
      confirmLabel: c.confirmLabel ?? "确认",
      cancelLabel: c.cancelLabel ?? "取消",
      danger: c.danger,
    });
  }

  private exprContext(
    base: Omit<ActionContext, "signal" | "priorOutputs">,
    priorOutputs: Record<string, JsonValue>,
  ): Record<string, JsonValue> {
    return {
      document: {
        documentId: base.component.documentId,
        sourcePath: base.sourcePath,
      },
      currentFile: { path: base.sourcePath },
      node: {
        id: base.component.componentId,
        type: base.component.type,
        props: base.componentProps,
      },
      // Phase 0：HostState 上下文（state）由 Phase 2 的 HostState binding 接入。
      state: {},
      event: base.eventPayload,
      outputs: priorOutputs,
    };
  }

  /** 按 Action Discriminator 求值该 Interface 明确声明的 Expr 字段。 */
  private evaluateFields(
    action: ActionSpec,
    context: Record<string, JsonValue>,
  ): Result<JsonObject> {
    const evalOpt = (expr: ExprV1 | null): Result<JsonValue | null> => {
      if (expr === null) return { ok: true, value: null };
      return evaluateExpr(expr, context);
    };
    const evalReq = (expr: ExprV1): Result<JsonValue> => evaluateExpr(expr, context);
    switch (action.type) {
      case "notice.show": {
        const message = evalReq(action.message);
        if (!message.ok) return message;
        return { ok: true, value: { message: message.value, level: action.level, durationMs: action.durationMs } };
      }
      case "file.open": {
        const path = evalReq(action.path);
        if (!path.ok) return path;
        const line = evalOpt(action.line);
        if (!line.ok) return line;
        const column = evalOpt(action.column);
        if (!column.ok) return column;
        return {
          ok: true,
          value: { path: path.value, disposition: action.disposition, line: line.value, column: column.value },
        };
      }
      case "url.open": {
        const url = evalReq(action.url);
        if (!url.ok) return url;
        return { ok: true, value: { url: url.value } };
      }
      case "command.execute": {
        const commandId = evalReq(action.commandId);
        if (!commandId.ok) return commandId;
        return { ok: true, value: { commandId: commandId.value } };
      }
      case "file.create": {
        const path = evalReq(action.path);
        if (!path.ok) return path;
        const content = evalReq(action.content);
        if (!content.ok) return content;
        return {
          ok: true,
          value: {
            path: path.value,
            content: content.value,
            createParents: action.createParents,
            ifExists: action.ifExists,
            openAfterCreate: action.openAfterCreate,
          },
        };
      }
      case "frontmatter.update": {
        const path = evalReq(action.path);
        if (!path.ok) return path;
        const patches: JsonValue[] = [];
        for (const patch of action.patches) {
          const key = evalReq(patch.key);
          if (!key.ok) return key;
          if (patch.op === "delete") {
            patches.push({ op: "delete", key: key.value });
          } else {
            const value = evalReq(patch.value);
            if (!value.ok) return value;
            patches.push(
              patch.op === "append"
                ? { op: "append", key: key.value, value: value.value, unique: patch.unique }
                : { op: "set", key: key.value, value: value.value },
            );
          }
        }
        return { ok: true, value: { path: path.value, patches } };
      }
      case "markdown.task.update": {
        const locator: Record<string, JsonValue> = {};
        for (const field of [
          "path",
          "expectedRawHash",
          "line",
          "expectedLineText",
          "expectedStatus",
        ] as const) {
          const r = evalReq(action.locator[field]);
          if (!r.ok) return r;
          locator[field] = r.value;
        }
        if (action.locator.blockId !== null) {
          const blockId = evalReq(action.locator.blockId);
          if (!blockId.ok) return blockId;
          locator.blockId = blockId.value;
        } else {
          locator.blockId = null;
        }
        const nextStatus = evalReq(action.nextStatus);
        if (!nextStatus.ok) return nextStatus;
        return { ok: true, value: { locator, nextStatus: nextStatus.value } };
      }
      case "clipboard.copy": {
        const text = evalReq(action.text);
        if (!text.ok) return text;
        const successMessage = evalOpt(action.successMessage);
        if (!successMessage.ok) return successMessage;
        return { ok: true, value: { text: text.value, successMessage: successMessage.value } };
      }
      default: {
        const exhaustive: never = action;
        return {
          ok: false,
          error: actionError(ERROR_CODES.ACTION_TYPE_UNKNOWN, `未知 Action: ${String(exhaustive)}`),
        };
      }
    }
  }

  private finished(
    actionId: ActionId,
    status: ActionExecutionResult["status"],
    error: ProtocolError,
    startedAtMs = this.options.clock.now(),
  ): ActionExecutionResult {
    return {
      actionId,
      status,
      startedAtMs,
      finishedAtMs: this.options.clock.now(),
      ...(error ? { error } : {}),
    };
  }
}

function summarizeStatus(results: readonly ActionExecutionResult[]): ActionSequenceResult["status"] {
  let hasSuccess = false;
  let hasFailed = false;
  let hasCancelled = false;
  for (const r of results) {
    if (r.status === "success") hasSuccess = true;
    if (r.status === "failed") hasFailed = true;
    if (r.status === "cancelled") hasCancelled = true;
  }
  if (hasCancelled) return "cancelled";
  if (hasFailed) return hasSuccess ? "partial" : "failed";
  return "success";
}

export type { ActionDefinition, ActionResolution, JsonSchema };
export { jsonValueEqual };
