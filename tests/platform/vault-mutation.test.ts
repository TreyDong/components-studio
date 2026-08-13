/**
 * VaultMutationPort 测试（《运行时与 SDK 协议 v1》第 4.4 节）：
 * frontmatter 严格 CAS、任务写回 CAS 与 drift 检测。
 * 使用纯对象 MockVault（不加载 obsidian 运行时）。
 */

import { describe, expect, it } from "vitest";
import type { MarkdownTaskLocator } from "../../src/platform/ports";
import { sha256HexSync } from "../../src/shared/hash";
import { ObsidianPathRules } from "../../src/platform/obsidian/ObsidianPathRules";
import { ObsidianVaultMutationPort } from "../../src/platform/obsidian/ObsidianVaultMutationPort";
import { patchFrontmatter } from "../../src/platform/obsidian/frontmatter";
import { MockVault, mockNormalizePath } from "./mock-vault";

const PATHS = new ObsidianPathRules({ normalize: mockNormalizePath });

function makePort(
  initial: Record<string, string> = {},
): { vault: MockVault; port: ObsidianVaultMutationPort } {
  const vault = new MockVault(initial);
  const port = new ObsidianVaultMutationPort({ vault, paths: PATHS });
  return { vault, port };
}

describe("patchFrontmatter（纯函数）", () => {
  const BASE = "---\ntitle: Old\ntags: [a, b]\n---\n# Body\ncontent\n";

  it("set 修改键并保留无关字段与正文（新键追加到块尾）", () => {
    const result = patchFrontmatter(BASE, {
      title: { op: "set", value: "New" },
      status: { op: "set", value: "draft" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(
        "---\ntitle: New\ntags: [a, b]\nstatus: draft\n---\n# Body\ncontent\n",
      );
    }
  });

  it("delete 移除键；无 frontmatter 时 delete 为 no-op 原样返回", () => {
    const deleted = patchFrontmatter(BASE, { tags: { op: "delete" } });
    expect(deleted.ok && deleted.value).toBe("---\ntitle: Old\n---\n# Body\ncontent\n");
    const noop = patchFrontmatter("plain body\n", { tags: { op: "delete" } });
    expect(noop.ok && noop.value).toBe("plain body\n");
  });

  it("无 frontmatter 时 set 新建 --- 块", () => {
    const result = patchFrontmatter("# Page\n", { author: { op: "set", value: "T" } });
    expect(result.ok && result.value).toBe("---\nauthor: T\n---\n# Page\n");
  });

  it("append 唯一追加；重复项不变；非数组值拒绝", () => {
    const appended = patchFrontmatter(BASE, {
      tags: { op: "append", value: "c", unique: true },
    });
    expect(appended.ok && appended.value).toBe(
      "---\ntitle: Old\ntags: [a, b, c]\n---\n# Body\ncontent\n",
    );
    const dup = patchFrontmatter(BASE, {
      tags: { op: "append", value: "a", unique: true },
    });
    expect(dup.ok && dup.value).toBe(BASE);
    const scalar = patchFrontmatter("---\ntags: plain\n---\nx", {
      tags: { op: "append", value: "a", unique: true },
    });
    expect(scalar.ok).toBe(false);
  });
});

describe("ObsidianVaultMutationPort.updateFrontmatter", () => {
  const PATH = "notes/page.md";
  const TEXT = "---\ntitle: Old\n---\nBody\n";

  it("完整文本严格比较通过 → 应用补丁 → 回读验证", async () => {
    const { vault, port } = makePort({ [PATH]: TEXT });
    const result = await port.updateFrontmatter({
      path: PATH,
      expectedFileText: TEXT,
      patch: { title: { op: "set", value: "New" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe(PATH);
      expect(result.value.text).toBe("---\ntitle: New\n---\nBody\n");
      expect(result.value.rawHash).toBe(sha256HexSync(result.value.text));
    }
    expect(vault.files.get(PATH)?.text).toBe("---\ntitle: New\n---\nBody\n");
  });

  it("expectedFileText 与磁盘不一致 → ACTION_FRONTMATTER_CONFLICT，磁盘不变", async () => {
    const { vault, port } = makePort({ [PATH]: TEXT });
    const drifted = "---\ntitle: Drifted\n---\nBody\n";
    vault.setText(PATH, drifted);
    const result = await port.updateFrontmatter({
      path: PATH,
      expectedFileText: TEXT,
      patch: { title: { op: "set", value: "New" } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_FRONTMATTER_CONFLICT");
    }
    expect(vault.files.get(PATH)?.text).toBe(drifted);
  });

  it("文件不存在 → EXTERNAL_FILE_DELETED", async () => {
    const { port } = makePort();
    const result = await port.updateFrontmatter({
      path: "missing.md",
      expectedFileText: TEXT,
      patch: { title: { op: "set", value: "New" } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXTERNAL_FILE_DELETED");
    }
  });
});

describe("ObsidianVaultMutationPort.updateMarkdownTask", () => {
  const PATH = "tasks.md";
  const TEXT = "- [ ] first task\n- [x] second task ^t2\n- [ ] third task\n";
  const LINE = 1; // "- [x] second task ^t2"
  const LINE_TEXT = "- [x] second task ^t2";

  function locator(overrides: Partial<MarkdownTaskLocator> = {}): MarkdownTaskLocator {
    return {
      path: PATH,
      expectedRawHash: sha256HexSync(TEXT),
      line: LINE,
      expectedLineText: LINE_TEXT,
      expectedStatus: "x",
      blockId: "t2",
      ...overrides,
    };
  }

  it("CAS 成功：验证 hash/行/状态/blockId 后切换状态并回读", async () => {
    const { vault, port } = makePort({ [PATH]: TEXT });
    const result = await port.updateMarkdownTask({
      locator: locator(),
      nextStatus: " ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("- [ ] first task\n- [ ] second task ^t2\n- [ ] third task\n");
    }
    expect(vault.files.get(PATH)?.text).toBe(
      "- [ ] first task\n- [ ] second task ^t2\n- [ ] third task\n",
    );
  });

  it("读取与 process 之间内容漂移（hash 过期）→ ACTION_TASK_LOCATOR_STALE", async () => {
    const { vault, port } = makePort({ [PATH]: TEXT });
    // 外部修改文件，使 expectedRawHash 与当前磁盘不一致。
    vault.setText(PATH, "- [ ] first task\n- [x] second task ^t2\n- [ ] CHANGED\n");
    const result = await port.updateMarkdownTask({
      locator: locator(),
      nextStatus: " ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_TASK_LOCATOR_STALE");
    }
  });

  it("调用方行文本错误（hash 正确但行已变）→ ACTION_TASK_CONFLICT", async () => {
    const { port } = makePort({ [PATH]: TEXT });
    const result = await port.updateMarkdownTask({
      locator: locator({ expectedLineText: "- [x] WRONG LINE" }),
      nextStatus: " ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_TASK_CONFLICT");
    }
  });

  it("状态字符不匹配 → ACTION_TASK_CONFLICT，不得按旧行号盲改", async () => {
    const { vault, port } = makePort({ [PATH]: TEXT });
    const result = await port.updateMarkdownTask({
      locator: locator({ expectedStatus: " " }),
      nextStatus: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_TASK_CONFLICT");
    }
    expect(vault.files.get(PATH)?.text).toBe(TEXT);
  });

  it("blockId 缺失 → ACTION_TASK_CONFLICT", async () => {
    const { port } = makePort({ [PATH]: TEXT });
    const result = await port.updateMarkdownTask({
      locator: locator({ blockId: "missing-block" }),
      nextStatus: " ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_TASK_CONFLICT");
    }
  });

  it("nextStatus 必须是单个非换行字符", async () => {
    const { port } = makePort({ [PATH]: TEXT });
    const multi = await port.updateMarkdownTask({
      locator: locator(),
      nextStatus: "xx",
    });
    expect(multi.ok).toBe(false);
    const newline = await port.updateMarkdownTask({
      locator: locator(),
      nextStatus: "\n",
    });
    expect(newline.ok).toBe(false);
  });
});
