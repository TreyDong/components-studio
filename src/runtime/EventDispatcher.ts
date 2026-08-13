/**
 * EventDispatcher（《运行时与 SDK 协议 v1》第 7.2 节）。
 *
 * 分发顺序：
 *   查 Definition.events[eventName] → 校验 payloadSchema →
 *   读 Node.events[eventName] → preventDefault/stopPropagation →
 *   按 concurrency drop/restart/queue → ActionRunner.run。
 *
 * 手势验证：WeakMap 私有记录（原生 Event → 记录、Handle → 记录）。
 * capture() 校验 Event.isTrusted、事件类型（pointer/keyboard）与宿主文档；
 * emit()/consumeHandle() 一次性消费 Handle 并签发 VerifiedActionTrigger。
 * 外部 Handle 随即失效，不能跨 await/序列化复用。
 *
 * 说明：同步窗口的严格强制需要事件分发包装（Phase 2 的 Editor/View 绑定层
 * 提供）；本实现校验 isTrusted + 类型 + 宿主文档 + 一次性消费，
 * 组件用类型断言、JSON、new Event() 制造的对象均无法通过 WeakMap 校验。
 */
import type {
  ActionExecutionResult,
  ActionSequenceResult,
  ActionSpec,
  ActionTrigger,
  ComponentEvent,
  EventDispatcher as EventDispatcherPort,
  VerifiedActionTrigger,
} from "./action-types";
import type { RuntimeDocumentPort, RuntimeHostStore, UiGestureHandle } from "./types";
import type { DiagnosticPort } from "./types";
import type { ComponentRegistry } from "../registry/ComponentRegistry";
import type { ActionRunner } from "./ActionRunner";
import type { ActionId, ErrorCode, JsonObject, ProtocolError, Result, ValidationIssue } from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import type {
  OpaqueActionSpecV1,
  PersistedActionSpecV1,
} from "@ocs/contracts/document";
import { validateAgainstSchema } from "../schema/validator";
import type { JsonSchema } from "../schema/validator";

// Handle/Trigger 品牌符号：通过整体对象断言满足 opaque 接口。
const GESTURE_BRAND = Symbol("ocs.ui-gesture");
const VERIFIED_BRAND = Symbol("ocs.verified-trigger");

interface GestureRecord {
  readonly event: Event;
  readonly hostId: string;
  readonly timestampMs: number;
  consumed: boolean;
}

interface RunningSequence {
  readonly controller: AbortController;
  readonly promise: Promise<ActionSequenceResult>;
}

function eventError(
  code: ErrorCode,
  message: string,
  details?: JsonObject,
): { ok: false; error: ProtocolError } {
  return {
    ok: false,
    error: {
      code,
      message,
      scope: "event",
      recoverable: false,
      retryable: false,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

function failedResult(error: { code: ErrorCode; message: string }): ActionSequenceResult {
  const now = Date.now();
  return {
    status: "failed",
    results: [
      {
        actionId: "" as ActionId,
        status: "failed",
        startedAtMs: now,
        finishedAtMs: now,
        error: { ...error, scope: "event", recoverable: false, retryable: false },
      },
    ],
  };
}

export interface EventDispatcherOptions {
  readonly runner: ActionRunner;
  readonly registry: ComponentRegistry;
  readonly document: RuntimeDocumentPort;
  readonly host: RuntimeHostStore;
  readonly diagnostics: DiagnosticPort;
}

export class EventDispatcher implements EventDispatcherPort {
  private readonly gestures = new WeakMap<Event, GestureRecord>();
  private readonly handleRecords = new WeakMap<UiGestureHandle, GestureRecord>();
  private readonly running = new Map<string, RunningSequence>();
  private readonly queues = new Map<string, Array<() => void>>();
  private readonly options: EventDispatcherOptions;

  constructor(options: EventDispatcherOptions) {
    this.options = options;
  }

  /** Renderer 只能在真实 pointer/click/keyboard 回调内同步调用。 */
  capture(nativeEvent: Event): Result<UiGestureHandle> {
    if (
      nativeEvent === null ||
      typeof nativeEvent !== "object" ||
      typeof (nativeEvent as { type?: unknown }).type !== "string"
    ) {
      return eventError(ERROR_CODES.EVENT_TRIGGER_DROPPED, "无效手势：不是 Event 对象");
    }
    if (nativeEvent.isTrusted !== true) {
      return eventError(
        ERROR_CODES.EVENT_TRIGGER_DROPPED,
        "无效手势：事件不可信（构造/派发事件被拒绝）",
      );
    }
    const type = nativeEvent.type;
    const isGestureType =
      type.startsWith("pointer") ||
      type === "click" ||
      type.startsWith("keydown") ||
      type.startsWith("keyup");
    if (!isGestureType) {
      return eventError(ERROR_CODES.EVENT_TRIGGER_DROPPED, `无效手势：事件类型 ${type} 不是 pointer/keyboard`);
    }
    const target = nativeEvent.target as Node | null;
    const snapshot = this.options.host.getSnapshot();
    if (
      target === null ||
      (typeof (target as { ownerDocument?: unknown }).ownerDocument === "object" &&
        (target as { ownerDocument: Document }).ownerDocument !== snapshot.ownerDocument)
    ) {
      return eventError(ERROR_CODES.EVENT_TRIGGER_DROPPED, "无效手势：事件目标不在当前 Host 文档内");
    }
    const timestampMs =
      typeof (nativeEvent as { timeStamp?: unknown }).timeStamp === "number"
        ? (nativeEvent as { timeStamp: number }).timeStamp
        : Date.now();
    const record: GestureRecord = {
      event: nativeEvent,
      hostId: snapshot.hostId,
      timestampMs,
      consumed: false,
    };
    this.gestures.set(nativeEvent, record);
    const handle = { __opaque: GESTURE_BRAND } as unknown as UiGestureHandle;
    this.handleRecords.set(handle, record);
    return { ok: true, value: handle };
  }
  consumeHandle(handle: UiGestureHandle): Result<VerifiedActionTrigger> {
    const record = this.handleRecords.get(handle);
    if (!record) {
      return eventError(ERROR_CODES.EVENT_TRIGGER_DROPPED, "无效手势：Handle 未注册或已失效");
    }
    if (record.consumed) {
      return eventError(ERROR_CODES.EVENT_TRIGGER_DROPPED, "无效手势：Handle 已被消费");
    }
    // 标记 consumed 但不从 WeakMap 删除：controlFor 仍需要原生 Event；
    // WeakMap 键为弱引用，Handle 与 Event 被回收后记录随之消失。
    record.consumed = true;
    const kind = record.event.type.startsWith("key") ? "keyboard" : "pointer";
    const verified = {
      __opaqueVerifiedTrigger: VERIFIED_BRAND,
      kind,
      timestampMs: record.timestampMs,
      hostId: record.hostId,
    } as unknown as VerifiedActionTrigger;
    return { ok: true, value: verified };
  }

  /** 由 scoped ComponentEventApi 构造 ComponentEvent.control 使用。 */
  controlFor(handle: UiGestureHandle): {
    preventDefault(): void;
    stopPropagation(): void;
  } {
    const record = this.handleRecords.get(handle) ?? null;
    const event = record?.event ?? null;
    return {
      preventDefault: () => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
      },
      stopPropagation: () => {
        if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      },
    };
  }

  async emit(event: ComponentEvent): Promise<ActionSequenceResult> {
    const registry = this.options.registry;
    const registered = registry.get(event.component.type);
    const definitionEvents = registered?.events ?? [];
    const eventDef = definitionEvents.find((e) => e.name === event.eventName) ?? null;
    if (eventDef) {
      const issues: ValidationIssue[] = [];
      validateAgainstSchema(
        event.payload,
        // EventDefinitionV1.payloadSchema 是 RuntimeJsonSchema（JsonObject）——
        // 契约里就是宽松 JSON；这里转换到 JsonSchema 视图校验。
        eventDef.payloadSchema as unknown as JsonSchema,
        {},
        issues,
      );
      if (issues.length > 0) {
        return failedResult({
          code: ERROR_CODES.EVENT_PAYLOAD_INVALID,
          message: `事件 ${event.eventName} payload 未通过 payloadSchema`,
        });
      }
    }
    const node = this.options.document.getSnapshot().nodes.get(event.component.componentId);
    const sequence = node?.events[event.eventName] ?? null;
    if (!sequence) {
      return { status: "success", results: [] };
    }
    if (sequence.preventDefault) {
      event.control.preventDefault();
    }
    if (sequence.stopPropagation) {
      event.control.stopPropagation();
    }
    const opaqueById = new Map<string, ActionSequenceResult>();
    const known: ActionSpec[] = [];
    for (const persisted of sequence.actions) {
      if (isOpaque(persisted)) {
        opaqueById.set(persisted.id, this.opaqueResult(persisted));
      } else {
        known.push(persisted as unknown as ActionSpec);
      }
    }
    if (known.length === 0 && opaqueById.size === 0) {
      return { status: "success", results: [] };
    }
    const snapshot = this.options.document.getSnapshot();
    const key = `${event.component.componentId}:${event.eventName}`;
    const doRun = (signal?: AbortSignal): Promise<ActionSequenceResult> =>
      this.options.runner.run({
        actions: known,
        context: {
          component: event.component,
          sourcePath: snapshot.sourcePath,
          componentProps: node?.props ?? {},
          eventPayload: event.payload,
          trigger: event.trigger,
          mode: event.mode,
        },
        signal,
      });

    const existing = this.running.get(key);
    if (existing) {
      if (sequence.concurrency === "drop") {
        this.options.diagnostics.warning({
          pointer: `component/${event.component.componentId}/events/${event.eventName}`,
          code: ERROR_CODES.EVENT_TRIGGER_DROPPED,
          message: "事件序列仍在运行，触发被 drop",
          severity: "warning",
        });
        return { status: "cancelled", results: [] };
      }
      if (sequence.concurrency === "restart") {
        existing.controller.abort();
        await existing.promise.catch(() => {});
      }
      if (sequence.concurrency === "queue") {
        const queue = this.queues.get(key) ?? [];
        this.queues.set(key, queue);
        if (queue.length >= sequence.maxQueue) {
          this.options.diagnostics.warning({
            pointer: `component/${event.component.componentId}/events/${event.eventName}`,
            code: ERROR_CODES.EVENT_QUEUE_FULL,
            message: "事件队列已满，触发被丢弃",
            severity: "warning",
          });
          return { status: "cancelled", results: [] };
        }
        return new Promise<ActionSequenceResult>((resolve) => {
          queue.push(() => {
            void this.executeSequence(key, doRun, opaqueById, sequence.actions).then(resolve);
          });
        });
      }
    }

    return this.executeSequence(key, doRun, opaqueById, sequence.actions);
  }

  private async executeSequence(
    key: string,
    doRun: (signal?: AbortSignal) => Promise<ActionSequenceResult>,
    opaqueById: ReadonlyMap<string, ActionSequenceResult>,
    originalActions: readonly PersistedActionSpecV1[],
  ): Promise<ActionSequenceResult> {
    const controller = new AbortController();
    const promise = doRun(controller.signal);
    this.running.set(key, { controller, promise });
    const runnerResult = await promise;
    const queue = this.queues.get(key) ?? [];
    if (queue.length > 0) {
      this.queues.set(key, queue.slice(1));
      queue[0]?.();
    } else {
      this.queues.delete(key);
      if (this.running.get(key)?.promise === promise) {
        this.running.delete(key);
      }
    }
    if (opaqueById.size === 0) {
      return runnerResult;
    }
    // 按 EventSequenceV1 原始顺序交错 opaque 与 known 结果。
    const knownResults = Array.from(runnerResult.results);
    const results: ActionExecutionResult[] = [];
    for (const persisted of originalActions) {
      if (isOpaque(persisted)) {
        const opaque = opaqueById.get(persisted.id);
        if (opaque) results.push(opaque.results[0]!);
      } else {
        const next = knownResults.shift();
        if (next) results.push(next);
      }
    }
    let hasCancelled = false;
    let hasFailed = false;
    let hasSuccess = false;
    for (const r of results) {
      if (r.status === "cancelled") hasCancelled = true;
      if (r.status === "failed") hasFailed = true;
      if (r.status === "success") hasSuccess = true;
    }
    const status = hasCancelled ? "cancelled" : hasFailed ? (hasSuccess ? "partial" : "failed") : "success";
    return { status, results };
  }

  private opaqueResult(action: OpaqueActionSpecV1): ActionSequenceResult {
    const now = Date.now();
    const code =
      action.classification === "future"
        ? ERROR_CODES.ACTION_VERSION_FUTURE
        : ERROR_CODES.ACTION_TYPE_UNKNOWN;
    const message =
      action.classification === "future"
        ? `Action ${action.type} 版本 ${action.specVersion} 高于运行时支持版本`
        : `未知 Action type: ${action.type}`;
    return {
      status: "failed",
      results: [
        {
          actionId: action.id,
          status: "failed",
          startedAtMs: now,
          finishedAtMs: now,
          error: { code, message, scope: "action", recoverable: false, retryable: false },
        },
      ],
    };
  }
}

function isOpaque(action: PersistedActionSpecV1): action is OpaqueActionSpecV1 {
  return "classification" in action;
}

export type { ActionTrigger, ComponentEvent };
