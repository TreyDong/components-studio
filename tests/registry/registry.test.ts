/**
 * ComponentRegistryImpl 测试（《运行时与 SDK 协议 v1》第 2.5 节）。
 * 覆盖：注册/重复注册、resolveForRender known/unknown/future、list 排序与过滤、
 * subscribe、codecView 解析、resolveForMigration。
 */

import { describe, expect, it, vi } from "vitest";
import { ComponentRegistryImpl } from "../../src/registry/ComponentRegistry";
import { ERROR_CODES } from "@ocs/contracts";
import type { ComponentType } from "@ocs/contracts";
import { coreLayoutDefinition } from "../../src/widgets/core-layout";
import { coreMarkdownDefinition } from "../../src/widgets/core-markdown";
import { timeClockDefinition } from "../../src/widgets/time-clock";

const LAYOUT = "core.layout" as ComponentType;
const MARKDOWN = "core.markdown" as ComponentType;
const CLOCK = "time.clock" as ComponentType;

describe("register", () => {
  it("注册成功；同一 type 重复注册失败且不覆盖", () => {
    const registry = new ComponentRegistryImpl();
    const first = registry.register(coreLayoutDefinition);
    expect(first.ok).toBe(true);
    expect(first.ok && first.value.type).toBe(LAYOUT);

    const dup = registry.register(coreLayoutDefinition);
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.error.code).toBe(ERROR_CODES.REGISTRY_TYPE_CONFLICT);
      expect(dup.error.scope).toBe("registry");
    }
    expect(registry.has(LAYOUT)).toBe(true);
  });

  it("非法定义注册返回 REGISTRY_DEFINITION_INVALID", () => {
    const registry = new ComponentRegistryImpl();
    const bad = {
      ...coreLayoutDefinition,
      manifest: { ...coreLayoutDefinition.manifest, type: "invalid type!" as import("@ocs/contracts").ComponentType },
    };
    const result = registry.register(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ERROR_CODES.REGISTRY_DEFINITION_INVALID);
    }
    expect(registry.has("invalid type!" as ComponentType)).toBe(false);
  });

  it("dispose 注销并通知订阅者", () => {
    const registry = new ComponentRegistryImpl();
    const listener = vi.fn();
    registry.subscribe(listener);
    const registration = registry.register(coreLayoutDefinition);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.has(LAYOUT)).toBe(true);

    if (registration.ok) {
      registration.value.dispose();
    }
    expect(registry.has(LAYOUT)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("resolveForRender", () => {
  it("当前版本 → known", () => {
    const registry = new ComponentRegistryImpl();
    registry.register(coreLayoutDefinition);
    const result = registry.resolveForRender(LAYOUT, 1);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.kind).toBe("known");
  });

  it("未知类型 → { kind: 'unknown' }（不抛错）", () => {
    const registry = new ComponentRegistryImpl();
    const result = registry.resolveForRender("some.missing" as ComponentType, 1);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "unknown") {
      expect(result.value.type).toBe("some.missing");
    }
  });

  it("未来 specVersion → { kind: 'future' }，携带双方版本", () => {
    const registry = new ComponentRegistryImpl();
    registry.register(coreLayoutDefinition);
    const result = registry.resolveForRender(LAYOUT, 9);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "future") {
      expect(result.value.fileSpecVersion).toBe(9);
      expect(result.value.supportedSpecVersion).toBe(1);
      expect(result.value.definition.manifest.type).toBe(LAYOUT);
    }
  });

  it("旧版本不渲染（Codec 已迁移；Runtime 不迁移）", () => {
    const registry = new ComponentRegistryImpl();
    registry.register(coreLayoutDefinition);
    const result = registry.resolveForRender(LAYOUT, 0);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.kind).toBe("unknown");
  });
});

describe("resolveForMigration", () => {
  it("版本相等返回空路径", () => {
    const registry = new ComponentRegistryImpl();
    registry.register(coreLayoutDefinition);
    const result = registry.resolveForMigration(LAYOUT, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fromVersion).toBe(1);
      expect(result.value.toVersion).toBe(1);
      expect(result.value.path).toEqual([]);
    }
  });

  it("未知类型 → COMPONENT_TYPE_UNKNOWN", () => {
    const registry = new ComponentRegistryImpl();
    const result = registry.resolveForMigration("nope.x" as ComponentType, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ERROR_CODES.COMPONENT_TYPE_UNKNOWN);
  });

  it("未来版本 → COMPONENT_VERSION_UNSUPPORTED", () => {
    const registry = new ComponentRegistryImpl();
    registry.register(coreLayoutDefinition);
    const result = registry.resolveForMigration(LAYOUT, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ERROR_CODES.COMPONENT_VERSION_UNSUPPORTED);
  });

  it("无迁移路径的旧版本 → MIGRATION_PATH_MISSING", () => {
    const registry = new ComponentRegistryImpl();
    registry.register(coreLayoutDefinition);
    const result = registry.resolveForMigration(LAYOUT, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ERROR_CODES.MIGRATION_PATH_MISSING);
  });
});

describe("list", () => {
  it("固定排序：类别顺序 → displayName → type", () => {
    const registry = new ComponentRegistryImpl();
    // 逆序注册，验证排序而非插入序。
    registry.register(timeClockDefinition);
    registry.register(coreLayoutDefinition);
    registry.register(coreMarkdownDefinition);
    const types = registry.list().map((d) => d.manifest.type);
    expect(types).toEqual([LAYOUT, MARKDOWN, CLOCK]);
  });

  it("过滤器：category / search", () => {
    const registry = new ComponentRegistryImpl();
    registry.register(coreLayoutDefinition);
    registry.register(coreMarkdownDefinition);
    registry.register(timeClockDefinition);

    const content = registry.list({ category: "content" });
    expect(content.map((d) => d.manifest.type)).toEqual([MARKDOWN]);

    const search = registry.list({ search: "时钟" });
    expect(search.map((d) => d.manifest.type)).toEqual([CLOCK]);

    const rootOnly = registry.list({ rootAllowed: true });
    expect(rootOnly.map((d) => d.manifest.type)).toEqual([LAYOUT]);

    const userCreatable = registry.list({ userCreatable: true });
    expect(userCreatable.length).toBe(3);
  });
});

describe("codecView", () => {
  it("resolveComponentType：known/unknown/future；dataSource/action 一律 unknown（Phase 0）", () => {
    const registry = new ComponentRegistryImpl();
    registry.register(coreLayoutDefinition);
    registry.register(coreMarkdownDefinition);
    const view = registry.codecView();

    const known = view.resolveComponentType(LAYOUT, 1);
    expect(known.kind).toBe("known");
    if (known.kind === "known") {
      expect(known.descriptor.currentSpecVersion).toBe(1);
      expect(known.descriptor.propsSchema.type).toBe("object");
      expect(known.descriptor.slots.map((s) => s.name)).toEqual(["children"]);
      expect(known.descriptor.migrations).toEqual([]);
      expect(known.descriptor.bindableTargets).toEqual([]);
    }

    const markdown = view.resolveComponentType(MARKDOWN, 1);
    expect(markdown.kind).toBe("known");
    if (markdown.kind === "known") {
      expect(markdown.descriptor.slots).toEqual([]);
      expect(markdown.descriptor.currentSpecVersion).toBe(1);
    }

    expect(view.resolveComponentType("missing.x" as ComponentType, 1).kind).toBe("unknown");
    const future = view.resolveComponentType(LAYOUT, 2);
    expect(future.kind).toBe("future");
    if (future.kind === "future") {
      expect(future.fileSpecVersion).toBe(2);
    }
    // 旧版本仍是 known：Codec 是唯一 Migration 执行者。
    expect(view.resolveComponentType(LAYOUT, 0).kind).toBe("known");

    expect(view.resolveDataSourceType("vault.query", 1).kind).toBe("unknown");
    expect(view.resolveActionType("file.open", 1).kind).toBe("unknown");
  });
});
