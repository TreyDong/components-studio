/**
 * ActionRunner 测试（协议 8.4–8.5）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionRunner } from "../../src/runtime/ActionRunner";
import { createOpenUrlHandler } from "../../src/runtime/actions/openUrl";
import type { ActionContext, ActionHandler } from "../../src/runtime/action-types";
import type { Capability, CapabilityBroker, CapabilityDecision } from "../../src/runtime/capability-types";
import type { ComponentId, ComponentType, JsonValue } from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import { newActionId } from "../../src/shared/id";
import { objectSchema } from "../../src/runtime/actions/shared";
import { FakeDiagnostics, FakePlatformPort, TEST_VAULT } from "./fakes";
import type { ShowNoticeActionV1 } from "@ocs/contracts/document";

const BASE_CONTEXT = {
  component: {
    documentId: "00000000-0000-4000-8000-0000000000aa" as never,
    componentId: "btn-1" as ComponentId,
    type: "test.button" as ComponentType,
    specVersion: 1,
    vendor: "components-studio",
    packageVersion: "0.1.0",
  },
  sourcePath: "home.components",
  componentProps: {},
  eventPayload: {},
  trigger: { kind: "pointer" as const, timestampMs: 1 },
  mode: "view" as const,
};

function makeNoticeHandler(options: {
  record: (value: JsonValue) => void;
  slow?: boolean;
  capabilities?: () => readonly Capability[];
  output?: JsonValue;
  outputSchema?: object;
}): ActionHandler {
  return {
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
      outputSchema: (options.outputSchema as never) ?? { type: "null" },
      migrations: [],
      minimumConfirmation: "never",
      requiredCapabilities: options.capabilities ?? (() => []),
    },
    execute: async (input, ctx) => {
      if (options.slow) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        if (ctx.signal.aborted) {
          return {
            ok: false,
            error: {
              code: ERROR_CODES.ACTION_CANCELLED,
              message: "aborted",
              scope: "action",
              recoverable: false,
              retryable: false,
            },
          };
        }
      }
      options.record((input as { message: JsonValue }).message);
      return options.output !== undefined
        ? { ok: true, value: options.output }
        : { ok: true, value: null };
    },
  };
}

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

function fakeCapabilities(decision: CapabilityDecision): CapabilityBroker {
  return {
    evaluate: () => decision,
    requestGrant: async (input: { capability: Capability; trigger: unknown }) =>
      ({ ...decision, capability: input.capability }) as never,
    assert: () => ({ ok: true, value: undefined }),
    revoke: async () => ({ ok: true, value: undefined }),
  } as never;
}

function makeRunner(options: {
  capabilities: unknown;
  handler: ActionHandler;
  platform?: FakePlatformPort;
}) {
  const platform = options.platform ?? new FakePlatformPort();
  const diag = new FakeDiagnostics();
  const runner = new ActionRunner({
    capabilities: options.capabilities as never,
    confirmations: platform.confirmations,
    clock: platform.clock,
    commands: platform.commands,
    diagnostics: diag,
    vaultId: TEST_VAULT,
  });
  const registered = runner.register(options.handler);
  if (!registered.ok) throw new Error("handler register failed");
  return { runner, platform, diag };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ActionRunner", () => {
  it("notice.show 执行：fake NoticePort 记录", async () => {
    const recorded: JsonValue[] = [];
    const { runner } = makeRunner({
      capabilities: fakeCapabilities({
        capability: "clipboard:write",
        granted: true,
        source: "built-in-policy",
        reason: "test",
      }),
      handler: makeNoticeHandler({ record: (v) => recorded.push(v) }),
    });
    const result = await runner.run({
      actions: [noticeSpec("hello")],
      context: BASE_CONTEXT,
    });
    expect(result.status).toBe("success");
    expect(recorded).toEqual(["hello"]);
  });

  it("when=false 跳过 Action", async () => {
    const recorded: JsonValue[] = [];
    const { runner } = makeRunner({
      capabilities: fakeCapabilities({
        capability: "clipboard:write",
        granted: true,
        source: "built-in-policy",
        reason: "test",
      }),
      handler: makeNoticeHandler({ record: (v) => recorded.push(v) }),
    });
    const result = await runner.run({
      actions: [noticeSpec("hello", { when: { op: "literal", value: false } })],
      context: BASE_CONTEXT,
    });
    expect(result.status).toBe("success");
    expect(result.results[0]?.status).toBe("skipped");
    expect(recorded).toEqual([]);
  });

  it("resultKey 把输出链入 outputs 上下文", async () => {
    const recorded: JsonValue[] = [];
    const { runner } = makeRunner({
      capabilities: fakeCapabilities({
        capability: "clipboard:write",
        granted: true,
        source: "built-in-policy",
        reason: "test",
      }),
      handler: makeNoticeHandler({
        record: (v) => recorded.push(v),
        output: { x: 42 },
        outputSchema: {
          type: "object",
          properties: { x: { type: "number" } },
          required: ["x"],
          additionalProperties: false,
        },
      }),
    });
    const first = noticeSpec("first", { resultKey: "r" });
    const second = noticeSpec(
      { op: "get", value: { op: "context", name: "outputs" }, pointer: "/r/x" },
      { when: null },
    );
    const result = await runner.run({
      actions: [first, second],
      context: BASE_CONTEXT,
    });
    expect(result.results.map((r) => [r.status, r.error?.code])).toEqual([
      ["success", undefined],
      ["success", undefined],
    ]);
    expect(recorded).toEqual(["first", 42]);
  });

  it("能力被拒绝时跳过 Handler", async () => {
    const recorded: JsonValue[] = [];
    const { runner } = makeRunner({
      capabilities: fakeCapabilities({
        capability: "vault:modify",
        granted: false,
        source: "document-not-requested",
        reason: "denied",
      }),
      handler: makeNoticeHandler({
        record: (v) => recorded.push(v),
        capabilities: () => ["vault:modify"],
      }),
    });
    const result = await runner.run({
      actions: [noticeSpec("hello")],
      context: BASE_CONTEXT,
    });
    expect(result.status).toBe("failed");
    expect(result.results[0]?.error?.code).toBe("ACTION_CAPABILITY_DENIED");
    expect(recorded).toEqual([]);
  });

  it("timeout 中止慢 Handler（AbortSignal 检查）", async () => {
    vi.useFakeTimers();
    const recorded: JsonValue[] = [];
    const { runner } = makeRunner({
      capabilities: fakeCapabilities({
        capability: "clipboard:write",
        granted: true,
        source: "built-in-policy",
        reason: "test",
      }),
      handler: makeNoticeHandler({ record: (v) => recorded.push(v), slow: true }),
    });
    const promise = runner.run({
      actions: [noticeSpec("hello", { timeoutMs: 100 })],
      context: BASE_CONTEXT,
    });
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;
    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.error?.code).toBe("ACTION_TIMEOUT");
    expect(recorded).toEqual([]);
  });

  it("resultKey 重复 / Action ID 重复被拒绝", async () => {
    const recorded: JsonValue[] = [];
    const { runner } = makeRunner({
      capabilities: fakeCapabilities({
        capability: "clipboard:write",
        granted: true,
        source: "built-in-policy",
        reason: "test",
      }),
      handler: makeNoticeHandler({ record: (v) => recorded.push(v) }),
    });
    const result = await runner.run({
      actions: [
        noticeSpec("a", { resultKey: "k" }),
        noticeSpec("b", { resultKey: "k" }),
      ],
      context: BASE_CONTEXT,
    });
    expect(result.status).toBe("failed");
    expect(result.results[0]?.error?.code).toBe("ACTION_RESULT_KEY_DUPLICATE");
    expect(recorded).toEqual([]);
  });
});

describe("url.open Handler", () => {
  it("javascript: scheme 被拒绝且不打开", async () => {
    const platform = new FakePlatformPort();
    const handler = createOpenUrlHandler(platform as never);
    const result = await handler.execute(
      { url: "javascript:alert(1)" } as never,
      null as unknown as ActionContext,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ACTION_URL_SCHEME_DENIED");
    expect(platform.openedUrls).toEqual([]);
  });

  it("https:// 正常打开", async () => {
    const platform = new FakePlatformPort();
    const handler = createOpenUrlHandler(platform as never);
    const result = await handler.execute(
      { url: "https://example.com/a?b=1" } as never,
      null as unknown as ActionContext,
    );
    expect(result.ok).toBe(true);
    expect(platform.openedUrls).toEqual(["https://example.com/a?b=1"]);
  });

  it("data:/file: scheme 被拒绝", async () => {
    const platform = new FakePlatformPort();
    const handler = createOpenUrlHandler(platform as never);
    for (const bad of ["data:text/html,hi", "file:///etc/passwd", "ftp://example.com"]) {
      const result = await handler.execute({ url: bad } as never, null as unknown as ActionContext);
      expect(result.ok).toBe(false);
    }
    expect(platform.openedUrls).toEqual([]);
  });
});
