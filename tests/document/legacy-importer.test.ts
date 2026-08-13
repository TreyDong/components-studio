/**
 * LegacyComponents25Importer 测试（文档协议第 8 章 / 验收 18.5）。
 * 使用用户的真实旧 2.5 文件（multi + custom 代码组件）做 fixture。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LegacyComponents25Importer, distributeBasis } from "../../src/document/legacy-importer";
import { DocumentCodec } from "../../src/document/codec";
import { ComponentRegistryImpl } from "../../src/registry/ComponentRegistry";
import { legacyComponents25Definition } from "../../src/widgets/legacy-components-2-5";

const FIXTURE = readFileSync(
  join(__dirname, "../fixtures/legacy-25-directory-list.components.json"),
);

const importer = new LegacyComponents25Importer();

function registryWithLegacy() {
  const registry = new ComponentRegistryImpl();
  const r = registry.register(legacyComponents25Definition);
  if (!r.ok) throw new Error("legacy 占位组件注册失败");
  return registry;
}

describe("LegacyComponents25Importer.inspect", () => {
  it("识别旧格式", () => {
    const r = importer.inspect(FIXTURE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rootComponentId).toBe("bfa903a2-46ca-4ae8-9874-d5dfadc4a1cb");
      expect(r.value.components).toHaveLength(2);
    }
  });

  it("拒绝无 rootComponentId 的 JSON", () => {
    const r = importer.inspect(new TextEncoder().encode('{"components":[]}'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("LEGACY_NOT_RECOGNIZED");
  });

  it("拒绝缺 id 的组件", () => {
    const r = importer.inspect(
      new TextEncoder().encode('{"rootComponentId":"r","components":[{"type":"multi"}]}'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("LEGACY_GRAPH_INVALID");
  });
});

describe("LegacyComponents25Importer.convert", () => {
  const now = "2026-08-13T12:00:00.000Z" as import("@ocs/contracts").UtcIsoDateTime;

  it("multi → core.layout，custom → legacy 占位；root 为 core.layout", () => {
    const r = importer.convert({
      sourcePath: "Dashboard/目录列表.components",
      sourceBytes: FIXTURE,
      targetPath: "Dashboard/目录列表-v1.components",
      now,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { document, report } = r.value;
    expect(document.kind).toBe("components-studio/document");
    expect(document.rootId).toBe(report.mappedIds["bfa903a2-46ca-4ae8-9874-d5dfadc4a1cb"]);
    const root = document.nodes[document.rootId]!;
    expect(root.type).toBe("core.layout");
    expect(root.props.mode).toBe("stack");
    expect(root.slots.children ?? []).toHaveLength(1);
    const childId = (root.slots.children ?? [])[0]!.nodeId;
    const child = document.nodes[childId]!;
    expect(child.type).toBe("legacy.components-2-5");
    expect((child.props as { legacyType: string }).legacyType).toBe("custom");
    // 原始 JSON 保留（含 viewCode 等可执行数据，但不执行）
    expect((child.props as { legacyNode: Record<string, unknown> }).legacyNode.viewCode).toBeTypeOf("string");
    expect(report.converted).toHaveLength(1);
    expect(report.preservedAsLegacy).toHaveLength(1);
    // 权限为空：不携带旧授权
    expect(document.permissions.requested).toEqual([]);
  });

  it("同一文件重复导入，DocumentId 与 ComponentId 一致", () => {
    const a = importer.convert({ sourcePath: "a", sourceBytes: FIXTURE, targetPath: "b", now });
    const b = importer.convert({ sourcePath: "a", sourceBytes: FIXTURE, targetPath: "c", now });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.document.documentId).toBe(b.value.document.documentId);
      expect(a.value.report.mappedIds).toEqual(b.value.report.mappedIds);
    }
  });

  it("转换结果通过 Codec 校验（legacy 占位已注册）", () => {
    const r = importer.convert({
      sourcePath: "Dashboard/目录列表.components",
      sourceBytes: FIXTURE,
      targetPath: "Dashboard/目录列表-v1.components",
      now,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const codec = new DocumentCodec(registryWithLegacy().codecView());
    const validated = codec.validate(r.value.document);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      console.error(validated.issues.slice(0, 5));
    }
  });

  it("旧 root 非 multi 时拒绝", () => {
    const bad = new TextEncoder().encode(
      JSON.stringify({
        rootComponentId: "r",
        components: [{ id: "r", type: "custom" }],
      }),
    );
    const r = importer.convert({ sourcePath: "x", sourceBytes: bad, targetPath: "y", now });
    expect(r.ok).toBe(false);
  });

  it("环检测", () => {
    const bad = new TextEncoder().encode(
      JSON.stringify({
        rootComponentId: "a",
        components: [
          { id: "a", type: "multi", components: [{ componentId: "b" }] },
          { id: "b", type: "multi", components: [{ componentId: "a" }] },
        ],
      }),
    );
    const r = importer.convert({ sourcePath: "x", sourceBytes: bad, targetPath: "y", now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("LEGACY_GRAPH_INVALID");
  });

  it("distributeBasis 总和严格 10000 且顺序确定", () => {
    const basis = distributeBasis([1, 1, 1]);
    expect(basis).toEqual([3334, 3333, 3333]);
    expect(basis.reduce((a, b) => a + b, 0)).toBe(10000);
    const weighted = distributeBasis([3, 1]);
    expect(weighted.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(weighted[0]!).toBeGreaterThan(weighted[1]!);
  });
});

describe("convert 不执行旧代码", () => {
  it("产物中 viewCode 仅是字符串数据", () => {
    const r = importer.convert({
      sourcePath: "x",
      sourceBytes: FIXTURE,
      targetPath: "y",
      now: "2026-08-13T12:00:00.000Z" as import("@ocs/contracts").UtcIsoDateTime,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const legacyNode = Object.values(r.value.document.nodes).find(
      (n) => n.type === "legacy.components-2-5",
    );
    expect(legacyNode).toBeDefined();
    const raw = legacyNode!.props as Record<string, unknown>;
    expect(typeof raw.legacyNode).toBe("object");
    expect(typeof (raw.legacyNode as Record<string, unknown>).viewCode).toBe("string");
    // 序列化后 viewCode 仍是字符串（数据），不是函数
    const text = JSON.stringify(raw.legacyNode);
    expect(text).toContain("viewCode");
  });
});
