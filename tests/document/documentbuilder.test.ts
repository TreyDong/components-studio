/**
 * DocumentBuilderImpl 测试（《文档与会话协议 v1》第 5.3 节）。
 * 覆盖：create 全字段与 codec.validate 通过、clone 保 ID 换 documentId。
 */

import { describe, expect, it } from "vitest";
import { DocumentBuilderImpl } from "../../src/document/DocumentBuilder";
import { ComponentRegistryImpl } from "../../src/registry/ComponentRegistry";
import { NodeFactoryImpl } from "../../src/registry/NodeFactory";
import { DocumentCodec } from "../../src/document/codec";
import { coreLayoutDefinition } from "../../src/widgets/core-layout";
import { coreMarkdownDefinition } from "../../src/widgets/core-markdown";
import { timeClockDefinition } from "../../src/widgets/time-clock";
import { isUuidV4, ERROR_CODES } from "@ocs/contracts";
import type { DocumentId } from "@ocs/contracts";

const NOW = "2026-08-13T09:24:31.428Z" as import("@ocs/contracts").UtcIsoDateTime;

function makeBuilder(): {
  registry: ComponentRegistryImpl;
  codec: DocumentCodec;
  builder: DocumentBuilderImpl;
} {
  const registry = new ComponentRegistryImpl();
  registry.register(coreLayoutDefinition);
  registry.register(coreMarkdownDefinition);
  registry.register(timeClockDefinition);
  const codec = new DocumentCodec(registry.codecView());
  const builder = new DocumentBuilderImpl({
    registry,
    nodeFactory: new NodeFactoryImpl(),
    codec,
  });
  return { registry, codec, builder };
}

describe("create", () => {
  it("生成合法 V1 文档：revision=0、时间=now、空集合、给定 metadata、UUID", () => {
    const { builder, codec } = makeBuilder();
    const result = builder.create({
      title: "主页",
      description: "个人动态主页",
      tags: ["dashboard"],
      now: NOW as import("@ocs/contracts").UtcIsoDateTime,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const doc = result.value;
      expect(doc.kind).toBe("components-studio/document");
      expect(doc.formatVersion).toBe(1);
      expect(doc.revision).toBe(0);
      expect(doc.createdAt).toBe(NOW);
      expect(doc.updatedAt).toBe(NOW);
      expect(isUuidV4(doc.documentId)).toBe(true);
      expect(isUuidV4(doc.rootId)).toBe(true);
      expect(doc.documentId).not.toBe(doc.rootId);

      const root = doc.nodes[doc.rootId];
      expect(root).toBeDefined();
      expect(root?.type).toBe("core.layout");
      expect(root?.id).toBe(doc.rootId);
      expect(root?.specVersion).toBe(1);
      expect(root?.enabled).toBe(true);
      expect(root?.slots).toEqual({ children: [] });

      expect(doc.dataSources).toEqual({});
      expect(doc.permissions.requested).toEqual([]);
      expect(doc.extensions).toEqual({});
      expect(doc.metadata).toEqual({ title: "主页", description: "个人动态主页", tags: ["dashboard"] });

      // 完整 Codec 校验通过。
      const validation = codec.validate(doc);
      expect(validation.ok).toBe(true);
      if (!validation.ok) {
        expect(validation.issues).toEqual([]);
      }
    }
  });

  it("每次 create 生成不同 documentId/rootId", () => {
    const { builder } = makeBuilder();
    const a = builder.create({ title: "a", description: "", tags: [], now: NOW });
    const b = builder.create({ title: "b", description: "", tags: [], now: NOW });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.documentId).not.toBe(b.value.documentId);
      expect(a.value.rootId).not.toBe(b.value.rootId);
    }
  });

  it("core.layout 未注册时失败", () => {
    const registry = new ComponentRegistryImpl();
    const codec = new DocumentCodec(registry.codecView());
    const builder = new DocumentBuilderImpl({ registry, nodeFactory: new NodeFactoryImpl(), codec });
    const result = builder.create({ title: "x", description: "", tags: [], now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ERROR_CODES.COMPONENT_TYPE_UNKNOWN);
  });
});

describe("clone", () => {
  it("保留所有组件 ID，使用新 documentId，revision=0、时间=now", () => {
    const { builder } = makeBuilder();
    const created = builder.create({
      title: "主页",
      description: "desc",
      tags: ["a"],
      now: NOW as import("@ocs/contracts").UtcIsoDateTime,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const newDocumentId = "7f9c6e5d-4a2b-4c3d-8e1f-0123456789ab" as DocumentId;
    const cloneResult = builder.clone(created.value, {
      documentId: newDocumentId,
      now: "2026-08-14T00:00:00.000Z" as import("@ocs/contracts").UtcIsoDateTime,
    });
    expect(cloneResult.ok).toBe(true);
    if (cloneResult.ok) {
      const clone = cloneResult.value;
      expect(clone.documentId).toBe(newDocumentId);
      expect(clone.documentId).not.toBe(created.value.documentId);
      expect(clone.rootId).toBe(created.value.rootId);
      expect(Object.keys(clone.nodes)).toEqual(Object.keys(created.value.nodes));
      expect(clone.nodes[clone.rootId]?.id).toBe(created.value.rootId);
      expect(clone.nodes[clone.rootId]?.props).toEqual(created.value.nodes[created.value.rootId]?.props);
      expect(clone.revision).toBe(0);
      expect(clone.createdAt).toBe("2026-08-14T00:00:00.000Z");
      expect(clone.updatedAt).toBe("2026-08-14T00:00:00.000Z");
      expect(clone.metadata).toEqual(created.value.metadata);
      expect(clone.dataSources).toEqual({});
      expect(clone.permissions.requested).toEqual([]);
    }
  });
});
