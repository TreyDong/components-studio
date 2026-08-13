/**
 * 严格 JSON 解析器（《文档与会话协议 v1》第 6.2 节）。
 *
 * - 检测所有层级的重复对象键（DOC_DUPLICATE_KEY）。
 * - 拒绝危险键 `__proto__` / `prototype` / `constructor`（DOC_FORBIDDEN_KEY）。
 * - 拒绝非有限数字（如 1e999 解析为 Infinity）。
 * - 单字符串长度上限 1,048,576 code points。
 * - 嵌套深度上限 512（防栈溢出；表达式深度限制由不变量层执行）。
 * 只调用原生 JSON.parse() 不合格。
 */

import type { JsonValue } from "@ocs/contracts/common";
import { DOCUMENT_LIMITS } from "@ocs/contracts/document";

export interface JsonParseIssue {
  code: "DOC_INVALID_JSON" | "DOC_DUPLICATE_KEY" | "DOC_FORBIDDEN_KEY";
  message: string;
  pointer: string;
  offset: number;
}

export type JsonParseResult =
  | { ok: true; value: JsonValue; maxDepth: number }
  | { ok: false; issue: JsonParseIssue };

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const MAX_DEPTH = 512;

export function parseJsonStrict(text: string): JsonParseResult {
  const parser = new Parser(text);
  return parser.parseDocument();
}

class Parser {
  private readonly text: string;
  private pos = 0;
  private maxDepth = 0;

  constructor(text: string) {
    this.text = text;
  }

  parseDocument(): JsonParseResult {
    this.skipWhitespace();
    if (this.pos >= this.text.length) {
      return { ok: false, issue: this.fail("JSON 文档为空", "") };
    }
    const value = this.parseValue(0);
    if (value === undefined) {
      return this.err
        ? { ok: false, issue: this.err }
        : { ok: false, issue: this.fail("JSON 语法错误", "") };
    }
    this.skipWhitespace();
    if (this.pos < this.text.length) {
      return { ok: false, issue: this.fail("JSON 末尾存在多余内容", "") };
    }
    return { ok: true, value, maxDepth: this.maxDepth };
  }

  private fail(message: string, pointer: string): JsonParseIssue {
    return { code: "DOC_INVALID_JSON", message, pointer, offset: this.pos };
  }

  private duplicateKey(pointer: string, key: string): JsonParseIssue {
    return {
      code: "DOC_DUPLICATE_KEY",
      message: `重复对象键: ${key}`,
      pointer,
      offset: this.pos,
    };
  }

  private forbiddenKey(pointer: string, key: string): JsonParseIssue {
    return {
      code: "DOC_FORBIDDEN_KEY",
      message: `禁止键: ${key}`,
      pointer,
      offset: this.pos,
    };
  }

  private skipWhitespace(): void {
    const t = this.text;
    while (this.pos < t.length) {
      const c = t.charCodeAt(this.pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.pos++;
      else break;
    }
  }

  private parseValue(depth: number): JsonValue | undefined {
    if (depth > this.maxDepth) this.maxDepth = depth;
    if (depth > MAX_DEPTH) {
      this.err = { code: "DOC_INVALID_JSON", message: "JSON 嵌套过深", pointer: "", offset: this.pos };
      return undefined;
    }
    this.skipWhitespace();
    if (this.pos >= this.text.length) {
      this.err = { code: "DOC_INVALID_JSON", message: "值未结束", pointer: "", offset: this.pos };
      return undefined;
    }
    const c = this.text[this.pos]!;
    switch (c) {
      case "{":
        return this.parseObject(depth + 1);
      case "[":
        return this.parseArray(depth + 1);
      case '"':
        return this.parseString();
      case "t":
        return this.parseLiteral("true", true);
      case "f":
        return this.parseLiteral("false", false);
      case "n":
        return this.parseLiteral("null", null);
      default:
        if (c === "-" || (c >= "0" && c <= "9")) return this.parseNumber();
        this.err = { code: "DOC_INVALID_JSON", message: `意外的字符: ${c}`, pointer: "", offset: this.pos };
        return undefined;
    }
  }

  private err: JsonParseIssue | null = null;

  private parseObject(depth: number): JsonValue | undefined {
    this.pos++; // consume '{'
    const out: Record<string, JsonValue> = {};
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.pos] === "}") {
      this.pos++;
      return out;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') {
        this.err = { code: "DOC_INVALID_JSON", message: "对象键必须是字符串", pointer: "", offset: this.pos };
        return undefined;
      }
      const key = this.parseString();
      if (key === undefined) return undefined;
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") {
        this.err = { code: "DOC_INVALID_JSON", message: "缺少冒号", pointer: "", offset: this.pos };
        return undefined;
      }
      this.pos++;
      const value = this.parseValue(depth);
      if (value === undefined) return undefined;
      if (FORBIDDEN_KEYS.has(key)) {
        this.err = this.forbiddenKey(`/${escapePointerSegment(key)}`, key);
        return undefined;
      }
      if (seen.has(key)) {
        this.err = this.duplicateKey(`/${escapePointerSegment(key)}`, key);
        return undefined;
      }
      seen.add(key);
      out[key] = value;
      this.skipWhitespace();
      const c = this.text[this.pos];
      if (c === ",") {
        this.pos++;
        continue;
      }
      if (c === "}") {
        this.pos++;
        return out;
      }
      this.err = { code: "DOC_INVALID_JSON", message: "对象缺少右括号", pointer: "", offset: this.pos };
      return undefined;
    }
  }

  private parseArray(depth: number): JsonValue | undefined {
    this.pos++; // consume '['
    const out: JsonValue[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === "]") {
      this.pos++;
      return out;
    }
    for (;;) {
      this.skipWhitespace();
      const value = this.parseValue(depth);
      if (value === undefined) return undefined;
      out.push(value);
      this.skipWhitespace();
      const c = this.text[this.pos];
      if (c === ",") {
        this.pos++;
        continue;
      }
      if (c === "]") {
        this.pos++;
        return out;
      }
      this.err = { code: "DOC_INVALID_JSON", message: "数组缺少右括号", pointer: "", offset: this.pos };
      return undefined;
    }
  }

  private parseString(): string | undefined {
    const start = this.pos;
    this.pos++; // consume '"'
    let out = "";
    for (;;) {
      if (this.pos >= this.text.length) {
        this.err = { code: "DOC_INVALID_JSON", message: "字符串未闭合", pointer: "", offset: start };
        return undefined;
      }
      const c = this.text[this.pos]!;
      if (c === '"') {
        this.pos++;
        if (Array.from(out).length > DOCUMENT_LIMITS.maxStringCodePoints) {
          this.err = {
            code: "DOC_INVALID_JSON",
            message: "字符串超过长度上限",
            pointer: "",
            offset: start,
          };
          return undefined;
        }
        return out;
      }
      if (c === "\\") {
        this.pos++;
        const esc = this.text[this.pos];
        if (esc === undefined) {
          this.err = { code: "DOC_INVALID_JSON", message: "字符串转义未完成", pointer: "", offset: start };
          return undefined;
        }
        switch (esc) {
          case '"': out += '"'; break;
          case "\\": out += "\\"; break;
          case "/": out += "/"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "n": out += "\n"; break;
          case "r": out += "\r"; break;
          case "t": out += "\t"; break;
          case "u": {
            const hex = this.text.slice(this.pos + 1, this.pos + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              this.err = { code: "DOC_INVALID_JSON", message: "非法 unicode 转义", pointer: "", offset: start };
              return undefined;
            }
            this.pos += 4;
            const code = parseInt(hex, 16);
            const ch = String.fromCharCode(code);
            out += ch;
            if (code >= 0xd800 && code <= 0xdbff) {
              // 代理对高位：期望低位
              if (this.text[this.pos + 1] === "\\" && this.text[this.pos + 2] === "u") {
                const hex2 = this.text.slice(this.pos + 3, this.pos + 7);
                if (/^[0-9a-fA-F]{4}$/.test(hex2)) {
                  const low = parseInt(hex2, 16);
                  if (low >= 0xdc00 && low <= 0xdfff) {
                    this.pos += 6;
                    out += String.fromCharCode(low);
                  }
                }
              }
            }
            break;
          }
          default:
            this.err = { code: "DOC_INVALID_JSON", message: `非法转义: \\${esc}`, pointer: "", offset: start };
            return undefined;
        }
        this.pos++;
        continue;
      }
      // 控制字符必须转义
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        this.err = { code: "DOC_INVALID_JSON", message: "字符串包含未转义控制字符", pointer: "", offset: this.pos };
        return undefined;
      }
      out += c;
      this.pos++;
    }
  }

  private parseNumber(): JsonValue | undefined {
    const start = this.pos;
    const t = this.text;
    if (t[this.pos] === "-") this.pos++;
    if (t[this.pos] === "0") {
      this.pos++;
    } else if (t[this.pos]! >= "1" && t[this.pos]! <= "9") {
      while (t[this.pos]! >= "0" && t[this.pos]! <= "9") this.pos++;
    } else {
      this.err = { code: "DOC_INVALID_JSON", message: "非法数字", pointer: "", offset: start };
      return undefined;
    }
    if (t[this.pos] === ".") {
      this.pos++;
      if (!(t[this.pos]! >= "0" && t[this.pos]! <= "9")) {
        this.err = { code: "DOC_INVALID_JSON", message: "非法小数", pointer: "", offset: start };
        return undefined;
      }
      while (t[this.pos]! >= "0" && t[this.pos]! <= "9") this.pos++;
    }
    if (t[this.pos] === "e" || t[this.pos] === "E") {
      this.pos++;
      if (t[this.pos] === "+" || t[this.pos] === "-") this.pos++;
      if (!(t[this.pos]! >= "0" && t[this.pos]! <= "9")) {
        this.err = { code: "DOC_INVALID_JSON", message: "非法指数", pointer: "", offset: start };
        return undefined;
      }
      while (t[this.pos]! >= "0" && t[this.pos]! <= "9") this.pos++;
    }
    const raw = t.slice(start, this.pos);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      this.err = { code: "DOC_INVALID_JSON", message: "非有限数字", pointer: "", offset: start };
      return undefined;
    }
    return value;
  }

  private parseLiteral(lit: string, value: JsonValue): JsonValue | undefined {
    if (this.text.slice(this.pos, this.pos + lit.length) !== lit) {
      this.err = { code: "DOC_INVALID_JSON", message: `非法字面量`, pointer: "", offset: this.pos };
      return undefined;
    }
    this.pos += lit.length;
    return value;
  }
}

function escapePointerSegment(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}
