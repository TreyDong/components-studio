/**
 * EventDispatcher 测试（协议 7.2）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionRunner } from "../../src/runtime/ActionRunner";
import { EventDispatcher } from "../../src/runtime/EventDispatcher";
import type { ActionHandler, VerifiedActionTrigger } from "../../src/runtime/action-types";
import type { JsonValue } from "@ocs/contracts";
import { newActionId } from "../../src/shared/id";
import {
  FakeDiagnostics,
  FakeDocumentPort,
  FakeHostStore,
  FakeRegistry,
  buildSnapshot,
  makeNode,
  TEST_DOCUMENT,
} from "./fakes";
import type { ComponentIdentity } from "../../src/runtime/types";
import { objectSchema } from "../../src/runtime/actions/shared";
import type { EventSequenceV1, ShowNoticeActionV1 } from "@ocs/contracts/document";
import type { RegisteredComponentDefinition } from "../../src/registry/definition";
import type { IconName } from "@ocs/contracts";

const IDENTITY: ComponentIdentity = {
  documentId: TEST_DOCUMENT,
  componentId: "btn-1" as never,
  type: "test.button" as never,
  specVersion: 1,
  vendor: "components-studio",
  packageVersion: "0.1.0",
};

function noticeSpec(message: JsonValue, overrides: Partial<ShowNoticeActionV1> = {}): ShowNoticeActionV1 {
  const messageExpr =
    message !== null &&
    typeof message === "object" &&
    !Array.isArray(message) &&
    "op" in message
      ? (message as unknown as { op: string; [k: string]: unknown })
      : { op: "literal", value: message };
  return {
    id: newActionId(),
    type: "notice.show",
    specVersion: 1,
    enabled: true,
    label: null,
    when: null,
    resultKey: null,
    timeoutMs: 1000,
    confirmation: {
      mode: "never",
      title: null,
      message: null,
      confirmLabel: null,
      cancelLabel: null,
      danger: false,
    },
    onError: "continue",
    extensions: {},
    message: messageExpr as never,
    level: "info",
    durationMs: 2000,
    ...overrides,
  };
}

/** 构造“可信”click 事件（jsdom 的 isTrusted 是实例上不可重定义的属性）。 */
function trustedClickEvent(): MouseEvent {
  const ev = Object.create(MouseEvent.prototype) as MouseEvent;
  Object.defineProperties(ev, {
    type: { value: "click" },
    isTrusted: { value: true },
    target: { value: document.body },
    timeStamp: { value: 1234 },
    // jsdom 的品牌方法要求真实实例；stub 掉以便 controlFor 调用。
    preventDefault: { value: () => {} },
    stopPropagation: { value: () => {} },
  });
  return ev;
}

function buttonDefinition(options: { payloadSchema?: unknown } = {}): RegisteredComponentDefinition {
  return {
    manifest: {
      type: "test.button" as never,
      specVersion: 1,
      displayName: "button",
      description: "",
      category: "action",
      icon: "circle" as IconName,
      keywords: [],
      vendor: "components-studio",
      packageVersion: "0.1.0",
      rootAllowed: true,
      userCreatable: true,
      declaredCapabilities: [],
    },
    propsSchema: { type: "object", properties: {}, required: [], additionalProperties: true } as never,
    slots: [],
    events: [
      {
        name: "press",
        payloadSchema:
          (options.payloadSchema as never) ??
          ({ type: "object", properties: {}, required: [], additionalProperties: true } as never),
      },
    ],
    bindableTargets: [],
    migrations: [],
    createCompanionDataSources: () => [],
    createDefaultPropsUnknown: () => ({}),
    validateUnknown: (input) => ({ ok: true, value: input as object, warnings: [] }),
    renderUnknown: () => null,
    inspectUnknown: () => null,
  };
}

function setup(options: {
  concurrency: EventSequenceV1["concurrency"];
  maxQueue?: number;
  actions?: ShowNoticeActionV1[];
  slowHandler?: boolean;
  payloadSchema?: unknown;
}) {
  const diag = new FakeDiagnostics();
  const runner = new ActionRunner({
    capabilities: {
      evaluate: () => ({ capability: "clipboard:write", granted: true, source: "built-in-policy", reason: "test" }),
      requestGrant: async (input: never) => input,
      assert: () => ({ ok: true, value: undefined }),
      revoke: async () => ({ ok: true, value: undefined }),
    } as never,
    confirmations: { confirm: async () => true },
    clock: {
      now: () => Date.now(),
      timeout: (cb: () => void, ms: number) => {
        const id = setTimeout(cb, ms);
        return { dispose: () => clearTimeout(id) };
      },
      interval: () => ({ dispose: () => {} }),
      aligned: () => ({ dispose: () => {} }),
    },
    commands: {
      list: () => [],
      execute: async () => ({ ok: true as const, value: undefined }),
      isAllowlisted: () => false,
    },
    diagnostics: diag,
    vaultId: "vault-test" as never,
  });
  const recorded: JsonValue[] = [];
  const handler: ActionHandler = {
    definition: {
      type: "notice.show",
      currentSpecVersion: 1,
      persistedSchema: { type: "object", properties: {}, required: [], additionalProperties: true },
      evaluatedInputSchema: objectSchema(
        {
          message: { oneOf: [{ type: "string" }, { type: "number" }] },
          level: { type: "string", enum: ["info", "success", "warning", "error"] },
          durationMs: { type: "integer", minimum: 1000, maximum: 10_000 },
        },
        ["message", "level", "durationMs"],
      ),
      outputSchema: { type: "null" },
      migrations: [],
      minimumConfirmation: "never",
      requiredCapabilities: () => [],
    },
    execute: async (input, ctx) => {
      if (options.slowHandler) {
        await new Promise<void>((resolve) => setTimeout(resolve, 80));
        if (ctx.signal.aborted) {
          return {
            ok: false,
            error: {
              code: "ACTION_CANCELLED",
              message: "aborted",
              scope: "action",
              recoverable: false,
              retryable: false,
            },
          };
        }
      }
      recorded.push(input.message as JsonValue);
      return { ok: true, value: null };
    },
  };
  const register = runner.register(handler);
  if (!register.ok) throw new Error("register failed");

  const registry = new FakeRegistry();
  registry.putDirect(buttonDefinition({ payloadSchema: options.payloadSchema }));

  const node = makeNode({
    id: "btn-1",
    type: "test.button",
    events: {
      press: {
        concurrency: options.concurrency,
        maxQueue: options.maxQueue ?? 0,
        preventDefault: true,
        stopPropagation: true,
        actions: options.actions ?? [noticeSpec("hello")],
      },
    },
  });
  const document = new FakeDocumentPort(buildSnapshot({ rootId: node.id, nodes: [node] }));
  const dispatcher = new EventDispatcher({
    runner,
    registry,
    document,
    host: new FakeHostStore(),
    diagnostics: diag,
  });
  return { dispatcher, document, diag, recorded };
}

function captureAndConsume(
  dispatcher: EventDispatcher,
): { trigger: ReturnType<typeof makeTrigger>; control: ReturnType<EventDispatcher["controlFor"]> } {
  const ev = trustedClickEvent();
  const captured = dispatcher.capture(ev);
  if (!captured.ok) throw new Error("capture failed");
  const verified = dispatcher.consumeHandle(captured.value);
  if (!verified.ok) throw new Error("consume failed");
  return {
    trigger: makeTrigger(verified.value),
    control: dispatcher.controlFor(captured.value),
  };
}

function makeTrigger(verified: VerifiedActionTrigger): {
  kind: "pointer" | "keyboard";
  timestampMs: number;
  verifiedGesture: VerifiedActionTrigger;
} {
  return {
    kind: verified.kind,
    timestampMs: verified.timestampMs,
    verifiedGesture: verified,
  };
}

function emitPress(
  dispatcher: EventDispatcher,
  overrides: { eventName?: string; payload?: Record<string, unknown>; componentId?: string } = {},
): ReturnType<EventDispatcher["emit"]> {
  const { trigger, control } = captureAndConsume(dispatcher);
  return dispatcher.emit({
    eventName: overrides.eventName ?? "press",
    component: { ...IDENTITY, componentId: (overrides.componentId ?? IDENTITY.componentId) as never },
    payload: (overrides.payload ?? {}) as never,
    trigger,
    mode: "view",
    control,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("EventDispatcher 手势验证", () => {
  it("拒绝不可信（构造/派发）事件", () => {
    const { dispatcher } = setup({ concurrency: "drop" });
    const ev = new MouseEvent("click", { bubbles: true });
    document.body.dispatchEvent(ev); // isTrusted=false
    const r = dispatcher.capture(ev);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("EVENT_TRIGGER_DROPPED");
  });

  it("拒绝非 pointer/keyboard 事件类型", () => {
    const { dispatcher } = setup({ concurrency: "drop" });
    const ev = Object.create(CustomEvent.prototype) as CustomEvent;
    Object.defineProperties(ev, {
      type: { value: "custom-thing" },
      isTrusted: { value: true },
      target: { value: document.body },
    });
    const r = dispatcher.capture(ev);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("pointer/keyboard");
  });

  it("Handle 一次性消费：第二次 consume 失败", () => {
    const { dispatcher } = setup({ concurrency: "drop" });
    const ev = trustedClickEvent();
    const captured = dispatcher.capture(ev);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(dispatcher.consumeHandle(captured.value).ok).toBe(true);
    const second = dispatcher.consumeHandle(captured.value);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("EVENT_TRIGGER_DROPPED");
  });

  it("drop 并发：运行期间的新触发被丢弃，Handler 只执行一次", async () => {
    vi.useFakeTimers();
    const { dispatcher, recorded, diag } = setup({ concurrency: "drop", slowHandler: true });
    const first = emitPress(dispatcher);
    const second = await emitPress(dispatcher);
    expect(second.status).toBe("cancelled");
    expect(second.results).toEqual([]);
    expect(diag.warnings.some((w) => w.code === "EVENT_TRIGGER_DROPPED")).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    const firstResult = await first;
    expect(firstResult.status).toBe("success");
    expect(recorded).toEqual(["hello"]);
  });

  it("payload 未通过 Definition payloadSchema 返回 EVENT_PAYLOAD_INVALID", async () => {
    const { dispatcher } = setup({
      concurrency: "drop",
      payloadSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    });
    const result = await emitPress(dispatcher, { payload: { wrong: true } });
    expect(result.status).toBe("failed");
    expect(result.results[0]?.error?.code).toBe("EVENT_PAYLOAD_INVALID");
  });

  it("节点不存在事件序列时返回空成功", async () => {
    const { dispatcher } = setup({ concurrency: "drop" });
    const result = await emitPress(dispatcher, { componentId: "other-node" });
    expect(result.status).toBe("success");
    expect(result.results).toEqual([]);
  });
});
