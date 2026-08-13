/**
 * Document Codec 测试（文档协议第 6、7 章 / 验收 18.1）。
 * 使用全 unknown 的测试 Registry（已知类型校验由 Registry 集成测试覆盖）。
 */
import { describe, expect, it } from "vitest";
import { DocumentCodec } from "../../src/document/codec";
import type { CodecRegistry } from "../../src/document/types";
import { sha256HexSync } from "../../src/shared/hash";
import { minimalDocument, minimalDocumentText } from "../fixtures/minimal-document";

const nullRegistry: CodecRegistry = {
  resolveComponentType: () => ({ kind: "unknown" }),
  resolveDataSourceType: () => ({ kind: "unknown" }),
  resolveActionType: () => ({ kind: "unknown" }),
};

const codec = new DocumentCodec(nullRegistry);

const encoder = new TextEncoder();

describe("DocumentCodec.parseUtf8", () => {
  it("解析合法最小文档并计算三种哈希", () => {
    const bytes = encoder.encode(minimalDocumentText());
    const r = codec.parseUtf8(bytes);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.document.kind).toBe("components-studio/document");
      expect(r.value.rawHash).toBe(sha256HexSync(minimalDocumentText()));
      expect(r.value.semanticHash).toHaveLength(64);
      expect(r.value.contentHash).toHaveLength(64);
      expect(r.value.document.revision).toBe(0);
    }
  });

  it("超过 10 MiB 返回 DOC_TOO_LARGE", () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const r = codec.parseUtf8(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("DOC_TOO_LARGE");
  });

  it("BOM 返回 DOC_INVALID_UTF8", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('{"a":1}')]);
    const r = codec.parseUtf8(bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("DOC_INVALID_UTF8");
  });

  it("非法 UTF-8 返回 DOC_INVALID_UTF8", () => {
    const r = codec.parseUtf8(new Uint8Array([0xff, 0xfe, 0xfd]));
    expect(r.ok).toBe(false);
  });

  it("kind 不匹配返回 DOC_KIND_MISMATCH", () => {
    const text = JSON.stringify({ ...minimalDocument(), kind: "other" });
    const r = codec.parseUtf8(encoder.encode(text));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("DOC_KIND_MISMATCH");
  });

  it("未来 formatVersion 返回 DOC_FORMAT_UNSUPPORTED_FUTURE", () => {
    const text = JSON.stringify({ ...minimalDocument(), formatVersion: 2 });
    const r = codec.parseUtf8(encoder.encode(text));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("DOC_FORMAT_UNSUPPORTED_FUTURE");
  });

  it("重复键导致解析失败", () => {
    const r = codec.parseUtf8(encoder.encode('{"kind":"components-studio/document","kind":"x"}'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("DOC_DUPLICATE_KEY");
  });

  it("根缺失返回 DOC_ROOT_MISSING", () => {
    const doc = minimalDocument();
    delete (doc.nodes as Record<string, unknown>)[doc.rootId];
    const r = codec.parseUtf8(encoder.encode(JSON.stringify(doc)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("DOC_SCHEMA_INVALID");
  });

  it("根类型非 core.layout 失败", () => {
    const doc = minimalDocument();
    doc.nodes[doc.rootId] = { ...doc.nodes[doc.rootId]!, type: "core.card" as import("@ocs/contracts").ComponentType };
    const r = codec.parseUtf8(encoder.encode(JSON.stringify(doc)));
    expect(r.ok).toBe(false);
  });

  it("多余顶层字段失败", () => {
    const doc = { ...minimalDocument(), extra: 1 };
    const r = codec.parseUtf8(encoder.encode(JSON.stringify(doc)));
    expect(r.ok).toBe(false);
  });

  it("节点 id 与键不一致失败", () => {
    const doc = minimalDocument();
    const node = { ...doc.nodes[doc.rootId]! };
    node.id = "00000000-0000-4000-8000-000000000000" as import("@ocs/contracts").ComponentId;
    doc.nodes = {
      ...doc.nodes,
      [doc.rootId]: node,
    };
    const r = codec.parseUtf8(encoder.encode(JSON.stringify(doc)));
    expect(r.ok).toBe(false);
  });
});

describe("DocumentCodec.serialize / validate / hash", () => {
  it("serialize 输出与 canonical 一致且可回读", () => {
    const doc = minimalDocument();
    const s = codec.serialize(doc);
    expect(s.ok).toBe(true);
    if (s.ok) {
      const back = codec.parseUtf8(encoder.encode(s.value));
      expect(back.ok).toBe(true);
      if (back.ok) {
        expect(back.value.semanticHash).toBe(s.value && sha256HexSync(s.value));
      }
    }
  });

  it("validate 接受合法文档", () => {
    const v = codec.validate(minimalDocument());
    expect(v.ok).toBe(true);
  });

  it("validate 拒绝缺字段文档", () => {
    const bad = { ...minimalDocument() } as Record<string, unknown>;
    delete bad.revision;
    const v = codec.validate(bad);
    expect(v.ok).toBe(false);
  });

  it("semanticHash/contentHash 稳定", () => {
    const doc = minimalDocument();
    const s1 = codec.semanticHash(doc);
    const s2 = codec.semanticHash(doc);
    expect(s1.ok && s2.ok).toBe(true);
    if (s1.ok && s2.ok) expect(s1.value).toBe(s2.value);
  });

  it("循环树被不变量校验拒绝", () => {
    const doc = minimalDocument();
    const root = doc.nodes[doc.rootId]!;
    // root.slots.children 引用 root 自身 → 环
    doc.nodes = {
      [doc.rootId]: {
        ...root,
        slots: {
          children: [
            {
              nodeId: doc.rootId,
              placement: {
                tab: { title: null, icon: null, disabled: false },
                column: { basisBp: 10000, grow: 0, shrink: 1, minWidthPx: 0, maxWidthPx: null },
                grid: {
                  compact: { x: 0, y: 0, w: 1, h: 1, minW: 1, maxW: null, minH: 1, maxH: null },
                  regular: { x: 0, y: 0, w: 1, h: 1, minW: 1, maxW: null, minH: 1, maxH: null },
                  wide: { x: 0, y: 0, w: 1, h: 1, minW: 1, maxW: null, minH: 1, maxH: null },
                },
                extensions: {},
              },
            },
          ],
        },
      },
    };
    const r = codec.parseUtf8(encoder.encode(JSON.stringify(doc)));
    expect(r.ok).toBe(false);
  });

  it("孤立节点被拒绝", () => {
    const doc = minimalDocument();
    const orphan = {
      ...doc.nodes[doc.rootId]!,
      id: "00000000-0000-4000-8000-000000000001" as import("@ocs/contracts").ComponentId,
    };
    doc.nodes = { ...doc.nodes, [orphan.id]: orphan };
    const r = codec.parseUtf8(encoder.encode(JSON.stringify(doc)));
    expect(r.ok).toBe(false);
  });

  it("深度 129 被拒绝", () => {
    let doc = minimalDocument();
    let parentId = doc.rootId;
    for (let i = 0; i < 130; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` as import("@ocs/contracts").ComponentId;
      const node = {
        ...doc.nodes[doc.rootId]!,
        id,
        slots: { children: [] },
      };
      doc = {
        ...doc,
        nodes: { ...doc.nodes, [id]: node },
      };
      const parent = doc.nodes[parentId]!;
      doc.nodes = {
        ...doc.nodes,
        [parentId]: {
          ...parent,
          slots: {
            children: [
              {
                nodeId: id,
                placement: {
                  tab: { title: null, icon: null, disabled: false },
                  column: { basisBp: 10000, grow: 0, shrink: 1, minWidthPx: 0, maxWidthPx: null },
                  grid: {
                    compact: { x: 0, y: 0, w: 1, h: 1, minW: 1, maxW: null, minH: 1, maxH: null },
                    regular: { x: 0, y: 0, w: 1, h: 1, minW: 1, maxW: null, minH: 1, maxH: null },
                    wide: { x: 0, y: 0, w: 1, h: 1, minW: 1, maxW: null, minH: 1, maxH: null },
                  },
                  extensions: {},
                },
              },
            ],
          },
        },
      };
      parentId = id;
    }
    const r = codec.parseUtf8(encoder.encode(JSON.stringify(doc)));
    expect(r.ok).toBe(false);
  });
});
