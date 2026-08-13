/**
 * CapabilityBroker 测试（协议 8.1 默认策略）。
 */
import { describe, expect, it } from "vitest";
import { CapabilityBroker, InMemoryCapabilityGrantStore } from "../../src/runtime/CapabilityBroker";
import type { CapabilitySubject } from "../../src/runtime/capability-types";
import type { VerifiedActionTrigger } from "../../src/runtime/action-types";
import type { ComponentId, ComponentType, IconName } from "@ocs/contracts";
import type { RegisteredComponentDefinition } from "../../src/registry/definition";
import {
  FakeDocumentPort,
  FakeRegistry,
  buildSnapshot,
  makeNode,
  TEST_VAULT,
} from "./fakes";

const SUBJECT: CapabilitySubject = {
  vaultId: TEST_VAULT,
  documentId: "00000000-0000-4000-8000-0000000000aa" as never,
  componentId: "clock-1" as ComponentId,
  componentType: "core.test" as ComponentType,
  vendor: "components-studio",
  packageVersion: "0.1.0",
};

function testDefinition(declared: string[]): RegisteredComponentDefinition {
  return {
    manifest: {
      type: "core.test" as ComponentType,
      specVersion: 1,
      displayName: "test",
      description: "",
      category: "custom",
      icon: "circle" as IconName,
      keywords: [],
      vendor: "components-studio",
      packageVersion: "0.1.0",
      rootAllowed: true,
      userCreatable: true,
      declaredCapabilities: declared as never,
    },
    propsSchema: { type: "object", properties: {}, required: [], additionalProperties: true } as never,
    slots: [],
    events: [],
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
  declared: string[];
  requested: Array<{ capability: string; reason: string }>;
  confirmResult?: boolean;
}) {
  const registry = new FakeRegistry();
  registry.putDirect(testDefinition(options.declared));
  const node = makeNode({ id: "clock-1", type: "core.test" });
  const document = new FakeDocumentPort(
    buildSnapshot({
      rootId: node.id,
      nodes: [node],
      permissions: { requested: options.requested as never },
    }),
  );
  const grants = new InMemoryCapabilityGrantStore();
  const broker = new CapabilityBroker({
    registry,
    document,
    confirmations: { confirm: async () => options.confirmResult ?? true },
    commands: { list: () => [], execute: async () => ({ ok: true as const, value: undefined }), isAllowlisted: () => false },
    grants,
    vaultId: TEST_VAULT,
  });
  return { broker, grants };
}

const verifiedTrigger = {
  kind: "pointer" as const,
  timestampMs: 1,
  hostId: "host-1",
} as unknown as VerifiedActionTrigger;

describe("CapabilityBroker.evaluate", () => {
  it("文档未请求 → document-not-requested 拒绝", () => {
    const { broker } = setup({ declared: ["query:read"], requested: [] });
    const d = broker.evaluate(SUBJECT, "query:read", "view");
    expect(d.granted).toBe(false);
    expect(d.source).toBe("document-not-requested");
  });

  it("Definition 未声明 → definition-not-declared 拒绝", () => {
    const { broker } = setup({
      declared: [],
      requested: [{ capability: "query:read", reason: "r" }],
    });
    const d = broker.evaluate(SUBJECT, "query:read", "view");
    expect(d.granted).toBe(false);
    expect(d.source).toBe("definition-not-declared");
  });

  it("内置策略：文档声明后 query:read 直接允许", () => {
    const { broker } = setup({
      declared: ["query:read", "timer:use"],
      requested: [{ capability: "query:read", reason: "列表" }],
    });
    const d = broker.evaluate(SUBJECT, "query:read", "view");
    expect(d.granted).toBe(true);
    expect(d.source).toBe("built-in-policy");
  });

  it("network:request 一律 mvp-deny 拒绝（即使声明并请求）", () => {
    const { broker } = setup({
      declared: ["network:request"],
      requested: [{ capability: "network:request", reason: "r" }],
    });
    const d = broker.evaluate(SUBJECT, "network:request", "view");
    expect(d.granted).toBe(false);
    expect(d.source).toBe("mvp-deny");
  });

  it("edit 模式拒绝写能力（runtime-mode-deny）", () => {
    const { broker } = setup({
      declared: ["vault:create"],
      requested: [{ capability: "vault:create", reason: "r" }],
    });
    const d = broker.evaluate(SUBJECT, "vault:create", "edit");
    expect(d.granted).toBe(false);
    expect(d.source).toBe("runtime-mode-deny");
  });
});

describe("CapabilityBroker.requestGrant", () => {
  it("缺少已验证手势 → 拒绝且不弹授权窗口", async () => {
    const { broker, grants } = setup({
      declared: ["clipboard:write"],
      requested: [{ capability: "clipboard:write", reason: "复制" }],
      confirmResult: true,
    });
    const d = await broker.requestGrant({
      subject: SUBJECT,
      capability: "clipboard:write",
      reason: "复制",
      mode: "view",
      trigger: { kind: "pointer", timestampMs: 1 },
    });
    expect(d.granted).toBe(false);
    expect(grants.list()).toEqual([]);
  });

  it("已验证手势 + 用户确认 → 授予并存储 Grant", async () => {
    const { broker, grants } = setup({
      declared: ["clipboard:write"],
      requested: [{ capability: "clipboard:write", reason: "复制" }],
      confirmResult: true,
    });
    const d = await broker.requestGrant({
      subject: SUBJECT,
      capability: "clipboard:write",
      reason: "复制",
      mode: "view",
      trigger: { kind: "pointer", timestampMs: 1, verifiedGesture: verifiedTrigger },
    });
    expect(d.granted).toBe(true);
    expect(d.source).toBe("user-grant");
    expect(grants.list().length).toBe(1);
    // 授权后 evaluate 直接命中 user-grant。
    const after = broker.evaluate(SUBJECT, "clipboard:write", "view");
    expect(after.granted).toBe(true);
    expect(after.source).toBe("user-grant");
  });

  it("用户拒绝确认 → 拒绝且不存储", async () => {
    const { broker, grants } = setup({
      declared: ["clipboard:write"],
      requested: [{ capability: "clipboard:write", reason: "复制" }],
      confirmResult: false,
    });
    const d = await broker.requestGrant({
      subject: SUBJECT,
      capability: "clipboard:write",
      reason: "复制",
      mode: "view",
      trigger: { kind: "pointer", timestampMs: 1, verifiedGesture: verifiedTrigger },
    });
    expect(d.granted).toBe(false);
    expect(grants.list()).toEqual([]);
  });

  it("内置 workspace:navigate 在验证手势下直接允许（无需对话框）", async () => {
    const { broker, grants } = setup({
      declared: ["workspace:navigate"],
      requested: [{ capability: "workspace:navigate", reason: "打开" }],
    });
    const d = await broker.requestGrant({
      subject: SUBJECT,
      capability: "workspace:navigate",
      reason: "打开",
      mode: "view",
      trigger: { kind: "pointer", timestampMs: 1, verifiedGesture: verifiedTrigger },
    });
    expect(d.granted).toBe(true);
    expect(d.source).toBe("built-in-policy");
    expect(grants.list()).toEqual([]);
  });
});
