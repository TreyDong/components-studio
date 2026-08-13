/**
 * 严格 JSON 解析器测试（文档协议第 6.2 节 / 验收 18.1）。
 */
import { describe, expect, it } from "vitest";
import { parseJsonStrict } from "../../src/document/json-parse";

describe("parseJsonStrict", () => {
  it("解析合法对象", () => {
    const r = parseJsonStrict('{"a":1,"b":[true,null,"x"]}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ a: 1, b: [true, null, "x"] });
    }
  });

  it("检测重复键并返回 DOC_DUPLICATE_KEY", () => {
    const r = parseJsonStrict('{"a":1,"a":2}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue.code).toBe("DOC_DUPLICATE_KEY");
      expect(r.issue.pointer).toBe("/a");
    }
  });

  it("嵌套重复键", () => {
    const r = parseJsonStrict('{"x":{"y":1,"y":2}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.code).toBe("DOC_DUPLICATE_KEY");
  });

  it("拒绝危险键 __proto__ / prototype / constructor", () => {
    for (const key of ["__proto__", "prototype", "constructor"]) {
      const r = parseJsonStrict(`{"${key}":1}`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issue.code).toBe("DOC_FORBIDDEN_KEY");
    }
  });

  it("拒绝尾随内容", () => {
    const r = parseJsonStrict('{"a":1} extra');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.code).toBe("DOC_INVALID_JSON");
  });

  it("拒绝空文档", () => {
    const r = parseJsonStrict("");
    expect(r.ok).toBe(false);
  });

  it("拒绝非有限数字 1e999", () => {
    const r = parseJsonStrict('{"a":1e999}');
    expect(r.ok).toBe(false);
  });

  it("拒绝未闭合字符串", () => {
    const r = parseJsonStrict('{"a":"unclosed}');
    expect(r.ok).toBe(false);
  });

  it("拒绝未转义控制字符", () => {
    const r = parseJsonStrict('{"a":"line\nbreak"}');
    expect(r.ok).toBe(false);
  });

  it("接受 unicode 转义与代理对", () => {
    const r = parseJsonStrict('{"a":"\\u4e2d\\ud83d\\ude00"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: "中😀" });
  });

  it("解析 -0 保留为 -0", () => {
    const r = parseJsonStrict("-0");
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.is(r.value, -0)).toBe(true);
  });

  it("拒绝非法字面量", () => {
    const r = parseJsonStrict("tru");
    expect(r.ok).toBe(false);
  });

  it("拒绝非法转义", () => {
    const r = parseJsonStrict('"\\q"');
    expect(r.ok).toBe(false);
  });
});
