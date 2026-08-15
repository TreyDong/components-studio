/**
 * 内置组件注册完整性测试。
 *
 * 守卫：BUILTIN_WIDGET_DEFINITIONS 中的每个组件都能注册成功、
 * 类型唯一、且关键组件没有被误删。防止"定义了组件但忘记注册"
 * 导致文档渲染时显示"缺少对应组件实现"。
 */
import { describe, expect, it } from "vitest";
import { ComponentRegistryImpl } from "../../src/registry/ComponentRegistry";
import { BUILTIN_WIDGET_DEFINITIONS } from "../../src/widgets";

describe("内置组件注册完整性", () => {
  it("所有内置组件均可注册且类型唯一", () => {
    const registry = new ComponentRegistryImpl();
    const types = new Set<string>();
    for (const definition of BUILTIN_WIDGET_DEFINITIONS) {
      const result = registry.register(definition as never);
      expect(result.ok, `注册失败: ${definition.manifest.type}`).toBe(true);
      types.add(definition.manifest.type);
    }
    expect(types.size).toBe(BUILTIN_WIDGET_DEFINITIONS.length);
  });

  it("清单包含全部 8 个内置组件类型", () => {
    const types = BUILTIN_WIDGET_DEFINITIONS.map((definition) => definition.manifest.type).sort();
    expect(types).toEqual([
      "core.data-table",
      "core.layout",
      "core.markdown",
      "core.nav-list",
      "core.stat-card",
      "legacy.components-2-5",
      "project.dashboard",
      "time.calendar",
      "time.clock",
    ].sort());
  });

  it("新组件声明无 Vault 能力（纯静态）", () => {
    const statCard = BUILTIN_WIDGET_DEFINITIONS.find((d) => d.manifest.type === "core.stat-card");
    const dataTable = BUILTIN_WIDGET_DEFINITIONS.find((d) => d.manifest.type === "core.data-table");
    expect(statCard?.manifest.declaredCapabilities).toEqual([]);
    expect(dataTable?.manifest.declaredCapabilities).toEqual([]);
  });
});
