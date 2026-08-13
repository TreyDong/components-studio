/**
 * 规范化序列化与哈希测试（文档协议第 6.4-6.5 节 / 验收 18.1）。
 */
import { describe, expect, it } from "vitest";
import {
  canonicalSerializeDocument,
  contentProjectionText,
} from "../../src/document/canonical";
import { sha256HexSync } from "../../src/shared/hash";
import { minimalDocument, ROOT_ID } from "../fixtures/minimal-document";

describe("canonicalSerializeDocument", () => {
  it("连续两次序列化字节完全一致", () => {
    const doc = minimalDocument();
    const a = canonicalSerializeDocument(doc);
    const b = canonicalSerializeDocument(doc);
    expect(a).toBe(b);
  });

  it("nodes 键按字典序输出，与插入顺序无关", () => {
    const doc = minimalDocument();
    const child2 = {
      ...(doc.nodes[ROOT_ID] as object),
      id: "aaaaaaaa-0000-4000-8000-000000000001" as import("@ocs/contracts").ComponentId,
    } as import("@ocs/contracts/document").ComponentNodeV1;
    const child1 = {
      ...(doc.nodes[ROOT_ID] as object),
      id: "bbbbbbbb-0000-4000-8000-000000000002" as import("@ocs/contracts").ComponentId,
    } as import("@ocs/contracts/document").ComponentNodeV1;
    // a 在前、b 在后
    const docAB = minimalDocument({
      nodes: {
        [ROOT_ID]: doc.nodes[ROOT_ID]!,
        [child1.id]: child1,
        [child2.id]: child2,
      },
    });
    // b 在前、a 在后（语义相同）
    const docBA = minimalDocument({
      nodes: {
        [child2.id]: child2,
        [ROOT_ID]: doc.nodes[ROOT_ID]!,
        [child1.id]: child1,
      },
    });
    expect(canonicalSerializeDocument(docAB)).toBe(canonicalSerializeDocument(docBA));
  });

  it("仅改变空格/换行 → semanticHash 不变", () => {
    const doc = minimalDocument();
    const hash = sha256HexSync(canonicalSerializeDocument(doc));
    const reindented = minimalDocument();
    expect(sha256HexSync(canonicalSerializeDocument(reindented))).toBe(hash);
  });

  it("-0 输出为 0", () => {
    const doc = minimalDocument();
    const root = doc.nodes[ROOT_ID]!;
    const withZero = minimalDocument({
      nodes: {
        [ROOT_ID]: {
          ...root,
          props: { ...(root.props as Record<string, unknown>), value: -0 },
        },
      },
    });
    const text = canonicalSerializeDocument(withZero);
    expect(text).toContain('"value": 0');
    expect(text).not.toContain('"value": -0');
  });

  it("末尾精确一个 LF", () => {
    const text = canonicalSerializeDocument(minimalDocument());
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("contentProjectionText 排除 revision 与 updatedAt，保留 createdAt", () => {
    const doc = minimalDocument({ revision: 5, updatedAt: "2026-08-14T00:00:00.000Z" as import("@ocs/contracts").UtcIsoDateTime });
    const projection = contentProjectionText(doc);
    expect(projection).not.toContain('"revision"');
    expect(projection).not.toContain('"updatedAt"');
    expect(projection).toContain('"createdAt"');
  });

  it("只改 revision/updatedAt → semanticHash 变、contentHash 不变", () => {
    const doc1 = minimalDocument();
    const doc2 = minimalDocument({
      revision: 1,
      updatedAt: "2026-08-14T00:00:00.000Z" as import("@ocs/contracts").UtcIsoDateTime,
    });
    const s1 = sha256HexSync(canonicalSerializeDocument(doc1));
    const s2 = sha256HexSync(canonicalSerializeDocument(doc2));
    const c1 = sha256HexSync(contentProjectionText(doc1));
    const c2 = sha256HexSync(contentProjectionText(doc2));
    expect(s1).not.toBe(s2);
    expect(c1).toBe(c2);
  });

  it("未知对象键按 Unicode code point 排序", () => {
    const doc = minimalDocument();
    const root = doc.nodes[ROOT_ID]!;
    const withProps = minimalDocument({
      nodes: {
        [ROOT_ID]: {
          ...root,
          props: {
            z: 1,
            a: 2,
            m: 3,
            "中": 4,
            A: 5,
          },
        },
      },
    });
    const text = canonicalSerializeDocument(withProps);
    // 键序：A, a, m, z, 中（code point 升序）
    const keys = ["A", "a", "m", "z", "中"];
    let last = -1;
    for (const k of keys) {
      const idx = text.indexOf(`"${k}":`);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });
});
