/**
 * ObsidianStorageAdapter 测试（《文档与会话协议 v1》第 11 章）。
 * 使用纯对象 MockVault（不加载 obsidian 运行时）。
 */

import { describe, expect, it } from "vitest";
import { sha256HexSync } from "../../src/shared/hash";
import { ObsidianPathRules } from "../../src/platform/obsidian/ObsidianPathRules";
import { ObsidianStorageAdapter } from "../../src/platform/obsidian/ObsidianStorageAdapter";
import { MockVault, mockNormalizePath } from "./mock-vault";

const PATHS = new ObsidianPathRules({ normalize: mockNormalizePath });

function makeAdapter(
  initial: Record<string, string> = {},
): { vault: MockVault; adapter: ObsidianStorageAdapter } {
  const vault = new MockVault(initial);
  const adapter = new ObsidianStorageAdapter({ vault, paths: PATHS });
  return { vault, adapter };
}

describe("ObsidianStorageAdapter.readText", () => {
  it("读取并归一化快照（rawHash 为同步 SHA-256）", async () => {
    const { adapter } = makeAdapter({ "Docs/a.components": "hello" });
    const result = await adapter.readText("Docs/a.components");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe("Docs/a.components");
      expect(result.value.text).toBe("hello");
      expect(result.value.rawHash).toBe(sha256HexSync("hello"));
      expect(result.value.sizeBytes).toBe(5);
    }
  });

  it("文件不存在返回 EXTERNAL_FILE_DELETED", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.readText("missing.components");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXTERNAL_FILE_DELETED");
    }
  });

  it("读取 IO 异常返回 STORAGE_READ_FAILED", async () => {
    const { vault, adapter } = makeAdapter({ "a.components": "x" });
    vault.readError = new Error("disk error");
    const result = await adapter.readText("a.components");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_READ_FAILED");
    }
  });
});

describe("ObsidianStorageAdapter.compareAndSwapText", () => {
  const PATH = "Dashboard/Home.components";
  const CURRENT = "{\"a\":1}";
  const NEXT = "{\"a\":2}";

  it("严格 CAS 成功：回调内相等 → 写入 → 回读验证 → written", async () => {
    const { vault, adapter } = makeAdapter({ [PATH]: CURRENT });
    const result = await adapter.compareAndSwapText({
      path: PATH,
      expectedText: CURRENT,
      expectedRawHash: sha256HexSync(CURRENT),
      nextText: NEXT,
    });
    expect(result.ok).toBe(true);
    expect(vault.processCalls).toBe(1);
    if (result.ok && result.value.kind === "written") {
      expect(result.value.snapshot.text).toBe(NEXT);
      expect(result.value.snapshot.rawHash).toBe(sha256HexSync(NEXT));
      expect(vault.files.get(PATH)?.text).toBe(NEXT);
    } else {
      throw new Error("expected written");
    }
  });

  it("回调内文本不匹配 → conflict，磁盘保持原文本", async () => {
    const { vault, adapter } = makeAdapter({ [PATH]: "other-content" });
    const result = await adapter.compareAndSwapText({
      path: PATH,
      expectedText: CURRENT,
      expectedRawHash: sha256HexSync(CURRENT),
      nextText: NEXT,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "conflict") {
      expect(result.value.current.text).toBe("other-content");
      expect(result.value.current.rawHash).toBe(sha256HexSync("other-content"));
      expect(vault.files.get(PATH)?.text).toBe("other-content");
    } else {
      throw new Error("expected conflict");
    }
  });

  it("目标不存在 → missing，且不创建文件", async () => {
    const { vault, adapter } = makeAdapter();
    const result = await adapter.compareAndSwapText({
      path: PATH,
      expectedText: CURRENT,
      expectedRawHash: sha256HexSync(CURRENT),
      nextText: NEXT,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("missing");
    }
    expect(vault.files.has(PATH)).toBe(false);
  });

  it("expectedRawHash 与 expectedText 不一致 → 立即失败（调用方状态损坏）", async () => {
    const { vault, adapter } = makeAdapter({ [PATH]: CURRENT });
    const result = await adapter.compareAndSwapText({
      path: PATH,
      expectedText: CURRENT,
      expectedRawHash: "deadbeef",
      nextText: NEXT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_WRITE_FAILED");
    }
    expect(vault.processCalls).toBe(0);
    expect(vault.files.get(PATH)?.text).toBe(CURRENT);
  });

  it("process 抛异常 → indeterminate（仍能读取时带当前快照）", async () => {
    const { vault, adapter } = makeAdapter({ [PATH]: CURRENT });
    vault.processError = new Error("atomic write failed");
    const result = await adapter.compareAndSwapText({
      path: PATH,
      expectedText: CURRENT,
      expectedRawHash: sha256HexSync(CURRENT),
      nextText: NEXT,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "indeterminate") {
      expect(result.value.error.code).toBe("SAVE_IO_FAILED");
      expect(result.value.current?.text).toBe(CURRENT);
    } else {
      throw new Error("expected indeterminate");
    }
  });

  it("回读文本与 nextText 不一致 → indeterminate(SAVE_VERIFY_FAILED)，不自动重试", async () => {
    const { vault, adapter } = makeAdapter({ [PATH]: CURRENT });
    vault.readOverride = () => "tampered-after-write";
    const result = await adapter.compareAndSwapText({
      path: PATH,
      expectedText: CURRENT,
      expectedRawHash: sha256HexSync(CURRENT),
      nextText: NEXT,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "indeterminate") {
      expect(result.value.error.code).toBe("SAVE_VERIFY_FAILED");
      expect(result.value.current?.text).toBe("tampered-after-write");
    } else {
      throw new Error("expected indeterminate");
    }
  });
});

describe("ObsidianStorageAdapter.writeNewText", () => {
  it("目标已存在 → SAVE_TARGET_EXISTS，绝不覆盖", async () => {
    const { vault, adapter } = makeAdapter({ "a.components": "old" });
    const result = await adapter.writeNewText("a.components", "new");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SAVE_TARGET_EXISTS");
    }
    expect(vault.files.get("a.components")?.text).toBe("old");
  });

  it("创建父目录并写入，回读验证", async () => {
    const { vault, adapter } = makeAdapter();
    const result = await adapter.writeNewText("a/b/c.components", "content");
    expect(result.ok).toBe(true);
    expect(vault.folders.has("a")).toBe(true);
    expect(vault.folders.has("a/b")).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("content");
      expect(result.value.rawHash).toBe(sha256HexSync("content"));
    }
  });
});

describe("ObsidianStorageAdapter.subscribe", () => {
  it("按归一化路径过滤 modify/rename/delete/create 事件", async () => {
    const { vault, adapter } = makeAdapter({ "x.components": "a" });
    const events: unknown[] = [];
    const unsubscribe = adapter.subscribe("x.components", (event) => {
      events.push(event);
    });
    vault.setText("x.components", "b");
    vault.putFile("other.components", "c");
    vault.emit("rename", { path: "y.components" }, "x.components");
    vault.deleteFile("x.components");
    expect(events).toEqual([
      { kind: "modified", path: "x.components" },
      { kind: "renamed", oldPath: "x.components", newPath: "y.components" },
      { kind: "deleted", path: "x.components" },
    ]);
    unsubscribe();
    vault.putFile("x.components", "again");
    expect(events).toHaveLength(3);
  });
});

describe("ObsidianPathRules（经 mock normalizePath）", () => {
  it("normalize 统一分隔符、解析 . 与 ..", () => {
    const slash = PATHS.normalize("a\\b//c");
    expect(slash.ok && slash.value).toBe("a/b/c");
    const dot = PATHS.normalize("a/./b");
    expect(dot.ok && dot.value).toBe("a/b");
    const dotdot = PATHS.normalize("a/b/../c");
    expect(dotdot.ok && dotdot.value).toBe("a/c");
  });

  it("拒绝逃逸、绝对路径、空路径与 NUL", () => {
    expect(PATHS.normalize("../escape").ok).toBe(false);
    expect(PATHS.normalize("/abs").ok).toBe(false);
    expect(PATHS.normalize("").ok).toBe(false);
    expect(PATHS.normalize("a\u0000b").ok).toBe(false);
  });

  it("resolve 支持 source-directory 基准", () => {
    const result = PATHS.resolve("child.components", {
      sourcePath: "Dashboard/Home.components",
      defaultBase: "source-directory",
    });
    expect(result.ok && result.value).toBe("Dashboard/child.components");
  });

  it("isInsideVault 对逃逸路径为 false", () => {
    expect(PATHS.isInsideVault("a/b.components")).toBe(true);
    expect(PATHS.isInsideVault("../outside")).toBe(false);
  });
});
