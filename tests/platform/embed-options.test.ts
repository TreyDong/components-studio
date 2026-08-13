/**
 * embed-options 解析器测试（《运行时与 SDK 协议 v1》第 4.7 节）。
 * 纯函数测试，无需 DOM 或 obsidian 模块。
 */

import { describe, expect, it } from "vitest";
import { parseComponentsEmbedOptions } from "../../src/platform/obsidian/embed-options";

describe("parseComponentsEmbedOptions", () => {
  it("解析完整合法配置", () => {
    const result = parseComponentsEmbedOptions(
      "src: Dashboard/Home.components\nmode: view\nheight: 600\nmaxWidth: 1200",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        src: "Dashboard/Home.components",
        mode: "view",
        height: 600,
        maxWidth: 1200,
      });
    }
  });

  it("height: auto 与省略 maxWidth", () => {
    const result = parseComponentsEmbedOptions(
      "src: a.components\nmode: view\nheight: auto",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ src: "a.components", mode: "view", height: "auto" });
      expect("maxWidth" in result.value).toBe(false);
    }
  });

  it("允许空行；src 值保留行尾文本（含冒号）", () => {
    const result = parseComponentsEmbedOptions(
      "\n\nsrc: notes/a:b.components\n\nmode: view\n",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.src).toBe("notes/a:b.components");
    }
  });

  it("缺少 src → 报错", () => {
    const result = parseComponentsEmbedOptions("mode: view");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("src");
    }
  });

  it("未知 key → 报错", () => {
    const result = parseComponentsEmbedOptions(
      "src: a.components\nmode: view\nzoom: 2",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("未知 key");
      expect(result.error.line).toBe(3);
    }
  });

  it("重复 key → 报错", () => {
    const result = parseComponentsEmbedOptions(
      "src: a.components\nsrc: b.components\nmode: view",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("重复");
      expect(result.error.line).toBe(2);
    }
  });

  it("mode 只能是 view", () => {
    const result = parseComponentsEmbedOptions("src: a.components\nmode: edit");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('"view"');
    }
  });

  it("height 非法值 → 报错（字符串/越界）", () => {
    expect(parseComponentsEmbedOptions("src: a\nmode: view\nheight: tall").ok).toBe(false);
    expect(parseComponentsEmbedOptions("src: a\nmode: view\nheight: 50").ok).toBe(false);
    expect(parseComponentsEmbedOptions("src: a\nmode: view\nheight: 10001").ok).toBe(false);
    expect(parseComponentsEmbedOptions("src: a\nmode: view\nheight: 100").ok).toBe(true);
  });

  it("maxWidth 非法值 → 报错（越界）", () => {
    expect(parseComponentsEmbedOptions("src: a\nmode: view\nmaxWidth: 239").ok).toBe(false);
    expect(parseComponentsEmbedOptions("src: a\nmode: view\nmaxWidth: 4001").ok).toBe(false);
    expect(parseComponentsEmbedOptions("src: a\nmode: view\nmaxWidth: 240").ok).toBe(true);
  });

  it("缺少冒号的行 → 报错", () => {
    const result = parseComponentsEmbedOptions("src: a.components\nnot-a-kv-line");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("缺少");
    }
  });
});
