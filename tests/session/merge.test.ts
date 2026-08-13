/**
 * 三方 Merge 单元测试（文档协议 14 章 / 验收 18.10 部分）。
 */
import { describe, expect, it } from "vitest";
import { threeWayMerge } from "../../src/session/merge";
import { DOC_ID_OTHER, makeDoc, placement, serializeDoc, unknownChild, unknownRegistry } from "./helpers";
import { DocumentCodec } from "../../src/document/codec";

function snapshotOf(doc: ReturnType<typeof makeDoc>) {
  const text = serializeDoc(doc);
  return {
    path: "Notes/Home.components",
    text,
    rawHash: "",
    mtimeMs: 1,
    sizeBytes: text.length,
  };
}

const codec = new DocumentCodec(unknownRegistry);

const Y_CHILD = unknownChild("00000000-0000-4000-8000-0000000000aa", "y");

function merge(base: ReturnType<typeof makeDoc>, local: ReturnType<typeof makeDoc>, remote: ReturnType<typeof makeDoc>) {
  const snapshot = snapshotOf(remote);
  snapshot.rawHash = `${remote.revision}`;
  return threeWayMerge({
    base,
    local,
    remote,
    remoteSnapshot: snapshot,
  });
}

describe("threeWayMerge 顶层字段", () => {
  it("不同字段自动合并（local 改 title，remote 改 tags）", () => {
    const base = makeDoc({ title: "Base", tags: ["a"] });
    const local = makeDoc({ title: "Local", tags: ["a"] });
    const remote = makeDoc({ title: "Base", tags: ["a", "b"], revision: 5 });
    const out = merge(base, local, remote);
    expect(out.aborted).toBe(false);
    expect(out.conflicts).toHaveLength(0);
    const doc = out.candidate!;
    expect(doc.metadata.title).toBe("Local");
    expect(doc.metadata.tags).toEqual(["a", "b"]);
    // 信封使用 Remote（14.3）
    expect(doc.revision).toBe(5);
  });

  it("同字段两侧不同值 → value Conflict", () => {
    const base = makeDoc({ title: "Base" });
    const local = makeDoc({ title: "Local1" });
    const remote = makeDoc({ title: "Remote1", revision: 5 });
    const out = merge(base, local, remote);
    expect(out.conflicts).toHaveLength(1);
    const c = out.conflicts[0]!;
    expect(c.kind).toBe("value");
    expect(c.pointer).toBe("/metadata/title");
    expect(c.base).toEqual({ kind: "value", value: "Base" });
    expect(c.local).toEqual({ kind: "value", value: "Local1" });
    expect(c.remote).toEqual({ kind: "value", value: "Remote1" });
    // 占位取 Base
    expect(out.candidate!.metadata.title).toBe("Base");
  });

  it("documentId 不同 → 中止，document-identity", () => {
    const base = makeDoc({});
    const local = makeDoc({});
    const remote = makeDoc({ documentId: DOC_ID_OTHER, revision: 5 });
    const out = merge(base, local, remote);
    expect(out.aborted).toBe(true);
    expect(out.candidate).toBeNull();
    expect(out.conflicts[0]?.kind).toBe("document-identity");
  });
});

describe("threeWayMerge Node 存在性（14.5）", () => {
  
  it("删除 + 未变 → 自动删除", () => {
    const base = makeDoc({ children: [Y_CHILD] });
    const local = makeDoc({ children: [] }); // local 删除
    const remote = makeDoc({ children: [Y_CHILD], revision: 5 }); // remote 未变
    const out = merge(base, local, remote);
    expect(out.conflicts).toHaveLength(0);
    expect(out.candidate!.nodes[Y_CHILD.id]).toBeUndefined();
  });

  it("删除 + 修改 → delete-modify", () => {
    const base = makeDoc({ children: [Y_CHILD] });
    const local = makeDoc({ children: [] });
    const remoteChild = { ...Y_CHILD, label: "改过" };
    const remote = makeDoc({ children: [remoteChild], revision: 5 });
    const out = merge(base, local, remote);
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0]!.kind).toBe("delete-modify");
    expect(out.conflicts[0]!.pointer).toBe(`/nodes/${Y_CHILD.id}`);
  });

  it("同一 id 两侧新增不同内容 → duplicate-add", () => {
    const sameId = "00000000-0000-4000-8000-0000000000aa" as const;
    const a = unknownChild(sameId, "a");
    const a2 = { ...unknownChild(sameId, "a"), label: "改过" };
    const base = makeDoc({ children: [] });
    const local = makeDoc({ children: [a] });
    const remote = makeDoc({ children: [a2], revision: 5 });
    const out = merge(base, local, remote);
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0]!.kind).toBe("duplicate-add");
    expect(out.conflicts[0]!.pointer).toBe(`/nodes/${sameId}`);
  });

  it("两侧新增不同 id → 双方都取 + 顺序 order-order", () => {
    const a = unknownChild("00000000-0000-4000-8000-0000000000aa", "a");
    const b = unknownChild("00000000-0000-4000-8000-0000000000bb", "b");
    const base = makeDoc({ children: [] });
    const local = makeDoc({ children: [a] });
    const remote = makeDoc({ children: [b], revision: 5 });
    const out = merge(base, local, remote);
    expect(out.conflicts.map((c) => c.kind)).toEqual(["order-order"]);
    // 占位取 Base（空）；两侧新增节点都被保留
    expect(out.candidate!.nodes[a.id]).toBeDefined();
    expect(out.candidate!.nodes[b.id]).toBeDefined();
  });
});

describe("threeWayMerge 位置与顺序（14.8）", () => {
  /** 构造 root 只把 a 放在给定 slot（其余 slot 为空数组）的文档。 */
  function docWithSlot(slot: string, a: ReturnType<typeof unknownChild>): ReturnType<typeof makeDoc> {
    const doc = makeDoc({ children: [] });
    const root = doc.nodes[doc.rootId]!;
    doc.nodes[doc.rootId] = {
      ...root,
      slots: {
        children: [],
        [slot]: [{ nodeId: a.id, placement: placement() }],
      },
    };
    doc.nodes[a.id] = a;
    return doc;
  }

  it("只一侧移动 → 采用该侧位置", () => {
    const a = unknownChild("00000000-0000-4000-8000-0000000000aa", "a");
    const base = makeDoc({ children: [a] });
    const local = makeDoc({ children: [a] });
    const remote = docWithSlot("alternate", a);
    const out = merge(base, local, { ...remote, revision: 5 });
    expect(out.conflicts).toHaveLength(0);
    const mergedRoot = out.candidate!.nodes[out.candidate!.rootId]!;
    expect(mergedRoot.slots.children).toHaveLength(0);
    expect(mergedRoot.slots.alternate).toHaveLength(1);
  });

  it("两侧移到不同 Slot → move-move", () => {
    const a = unknownChild("00000000-0000-4000-8000-0000000000aa", "a");
    const base = makeDoc({ children: [a] });
    const local = docWithSlot("slotA", a);
    const remote = docWithSlot("slotB", a);
    const out = merge(base, local, { ...remote, revision: 5 });
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0]!.kind).toBe("move-move");
  });

  it("未知节点字段经 Merge 后原样保留", () => {
    const base = makeDoc({ children: [Y_CHILD] });
    const local = makeDoc({ children: [Y_CHILD], title: "Local" });
    const remote = makeDoc({ children: [Y_CHILD], revision: 5, tags: ["x"] });
    const out = merge(base, local, remote);
    expect(out.conflicts).toHaveLength(0);
    const mergedY = out.candidate!.nodes[Y_CHILD.id];
    expect(mergedY).toBeDefined();
    expect(mergedY!.props).toEqual(Y_CHILD.props);
    expect(mergedY!.extensions).toEqual(Y_CHILD.extensions);
  });
});

describe("threeWayMerge 校验通过", () => {
  it("自动合并结果通过 codec.validate", () => {
    const base = makeDoc({ title: "Base", tags: ["a"] });
    const local = makeDoc({ title: "Local", tags: ["a"] });
    const remote = makeDoc({ title: "Base", tags: ["a", "b"], revision: 5 });
    const out = merge(base, local, remote);
    const v = codec.validate(out.candidate);
    expect(v.ok).toBe(true);
  });
});
