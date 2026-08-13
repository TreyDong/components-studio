/**
 * defineComponent / validateComponentDefinition 测试（《运行时与 SDK 协议 v1》第 2.5 节规则 7）。
 */

import { describe, expect, it } from "vitest";
import { defineComponent, packageMajorOf, validateComponentDefinition } from "../../src/registry/defineComponent";
import { coreLayoutDefinition } from "../../src/widgets/core-layout";
import { ERROR_CODES } from "@ocs/contracts";
import type { ComponentType } from "@ocs/contracts";
import type { ComponentMigrationV1 } from "@ocs/contracts/document";
import type { NewDataSourceDraft } from "../../src/registry/definition";

const LAYOUT = "core.layout" as ComponentType;

function expectInvalid(definition: object): void {
  const outcome = validateComponentDefinition(definition as Parameters<typeof defineComponent>[0]);
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect(outcome.error.code).toBe(ERROR_CODES.REGISTRY_DEFINITION_INVALID);
    expect(outcome.error.scope).toBe("registry");
  }
}

describe("defineComponent 通过路径", () => {
  it("合法定义原样返回（不变形）", () => {
    const out = defineComponent(coreLayoutDefinition);
    expect(out).toBe(coreLayoutDefinition);
  });

  it("packageMajorOf 取 SemVer 主版本", () => {
    expect(packageMajorOf("0.1.0")).toBe(0);
    expect(packageMajorOf("1.2.3")).toBe(1);
    expect(packageMajorOf("12.0.0-alpha.1")).toBe(12);
  });
});

describe("defineComponent 非法路径", () => {
  it("非法 type 模式 → REGISTRY_DEFINITION_INVALID", () => {
    const bad = {
      ...coreLayoutDefinition,
      manifest: { ...coreLayoutDefinition.manifest, type: "Bad_Type" },
    };
    expectInvalid(bad);
  });

  it("空 displayName / description 失败", () => {
    const badName = {
      ...coreLayoutDefinition,
      manifest: { ...coreLayoutDefinition.manifest, displayName: "  " },
    };
    expectInvalid(badName);
    const badDesc = {
      ...coreLayoutDefinition,
      manifest: { ...coreLayoutDefinition.manifest, description: "" },
    };
    expectInvalid(badDesc);
  });

  it("非法 icon 名失败", () => {
    const bad = {
      ...coreLayoutDefinition,
      manifest: { ...coreLayoutDefinition.manifest, icon: "Layout Grid!" },
    };
    expectInvalid(bad);
  });

  it("specVersion 非整数 / <1 失败", () => {
    const bad = {
      ...coreLayoutDefinition,
      manifest: { ...coreLayoutDefinition.manifest, specVersion: 0 },
    };
    expectInvalid(bad);
  });

  it("非法 packageVersion 失败（严格 SemVer）", () => {
    const bad = {
      ...coreLayoutDefinition,
      manifest: { ...coreLayoutDefinition.manifest, packageVersion: "v1.0" },
    };
    expectInvalid(bad);
  });

  it("空 vendor 失败", () => {
    const bad = {
      ...coreLayoutDefinition,
      manifest: { ...coreLayoutDefinition.manifest, vendor: "" },
    };
    expectInvalid(bad);
  });

  it("propsSchema 含不受支持关键字（const）失败", () => {
    const bad = {
      ...coreLayoutDefinition,
      propsSchema: {
        ...coreLayoutDefinition.propsSchema,
        properties: {
          ...coreLayoutDefinition.propsSchema.properties,
          locked: { type: "boolean", const: false },
        },
      },
    };
    expectInvalid(bad);
  });

  it("slot 名重复失败", () => {
    const bad = {
      ...coreLayoutDefinition,
      slots: [coreLayoutDefinition.slots[0]!, coreLayoutDefinition.slots[0]!],
    };
    expectInvalid(bad);
  });

  it("event 名重复失败", () => {
    const dupEvents = [
      { name: "click", payloadSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
      { name: "click", payloadSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
    ];
    const bad = { ...coreLayoutDefinition, events: dupEvents };
    expectInvalid(bad);
  });

  it("迁移链断裂或未排序失败", () => {
    const migration = (from: number, to: number): ComponentMigrationV1 =>
      ({
        type: LAYOUT,
        from,
        to,
        migrate: () => ({ ok: true, value: {} }),
      }) as unknown as ComponentMigrationV1;

    const gap = { ...coreLayoutDefinition, migrations: [migration(1, 2), migration(3, 4)] };
    expectInvalid(gap);

    const unsorted = { ...coreLayoutDefinition, migrations: [migration(2, 3), migration(1, 2)] };
    expectInvalid(unsorted);
  });

  it("bindableTargets 非空指针 / 未转义 ~ 失败", () => {
    expectInvalid({ ...coreLayoutDefinition, bindableTargets: [""] });
    expectInvalid({ ...coreLayoutDefinition, bindableTargets: ["text/with~raw"] });
  });

  it("默认 Props 未通过 validate 失败", () => {
    const bad = {
      ...coreLayoutDefinition,
      validate: () => ({
        ok: false,
        issues: [
          { pointer: "$", code: ERROR_CODES.COMPONENT_PROPS_INVALID, message: "nope", severity: "error" },
        ],
      }),
    };
    expectInvalid(bad);
  });

  it("配套数据源 key 重复 / type 非 vault.query 失败", () => {
    const draft = (key: string): NewDataSourceDraft => ({
      key,
      type: "vault.query",
      specVersion: 1,
      enabled: true,
      label: null,
      config: {},
      refresh: { mode: "manual" },
      extensions: {},
    });
    const dup = { ...coreLayoutDefinition, createCompanionDataSources: () => [draft("primary"), draft("primary")] };
    expectInvalid(dup);
    const wrongType = {
      ...coreLayoutDefinition,
      createCompanionDataSources: () => [{ ...draft("primary"), type: "custom.source" }],
    };
    expectInvalid(wrongType);
  });

  it("defineComponent 抛 REGISTRY_DEFINITION_INVALID", () => {
    const bad = {
      ...coreLayoutDefinition,
      manifest: { ...coreLayoutDefinition.manifest, packageVersion: "x.y" },
    };
    let caught: unknown;
    try {
      defineComponent(bad as Parameters<typeof defineComponent>[0]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ code: ERROR_CODES.REGISTRY_DEFINITION_INVALID });
  });
});
