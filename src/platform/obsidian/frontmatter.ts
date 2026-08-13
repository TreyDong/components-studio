/**
 * 前端 YAML-ish Frontmatter 补丁（《运行时与 SDK 协议 v1》第 4.4 节）。
 *
 * 用于 Vault.process() 的同步回调内：完整文本严格比较通过后，应用
 * `patch`（set/delete/append），保留正文、换行风格和无关字段。
 *
 * 这是刻意最小化的 YAML 子集：
 * - 识别 `---\n ... \n---` 块；识别 `key: value` 行（键位于行首）。
 * - 序列化：字符串在安全时用裸值，否则双引号（JSON.stringify）；
 *   数字/布尔/null 用字面量；数组/对象用 JSON.stringify（js-yaml 可读）。
 * - append 仅支持数组值：解析 `[a, b]` 列表（不做引号内逗号转义，
 *   文档化限制），唯一追加。
 */

import type { JsonValue, Result } from "@ocs/contracts";
import type { FrontmatterPatchOperation } from "../ports";
import { ok } from "./obsidian-api";

const FM_OPEN = "---";
const SAFE_BARE = /^[A-Za-z0-9_][A-Za-z0-9_ .\-/]*$/;

export function serializeYamlValue(value: JsonValue): string {
  if (typeof value === "string") {
    return SAFE_BARE.test(value) && !value.startsWith("-") && !value.startsWith("?")
      ? value
      : JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

function serializeItem(value: JsonValue): string {
  return typeof value === "string" && SAFE_BARE.test(value)
    ? value
    : JSON.stringify(value);
}

interface FrontmatterStructure {
  readonly hasFrontmatter: boolean;
  /** 开/闭 `---` 之间的行（不含围栏）。 */
  readonly headerLines: string[];
  /** 闭围栏之后的行。 */
  readonly bodyLines: string[];
}

/** 拆分文件文本为 frontmatter 结构；无 frontmatter 时 body 即全文。 */
export function splitFrontmatter(text: string): FrontmatterStructure {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[0] === FM_OPEN) {
    const closing = lines.indexOf(FM_OPEN, 1);
    if (closing >= 0) {
      return {
        hasFrontmatter: true,
        headerLines: lines.slice(1, closing),
        bodyLines: lines.slice(closing + 1),
      };
    }
  }
  return { hasFrontmatter: false, headerLines: [], bodyLines: lines };
}

function findKeyLine(lines: readonly string[], key: string): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = /^([^:]+):(?:\s|$)/.exec(line);
    if (match && match[1]!.trim() === key) {
      return i;
    }
  }
  return -1;
}

/** 解析 `[a, b, "c"]` 列表；失败返回 null。 */
function parseListItems(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return null;
  }
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return [];
  }
  const items: string[] = [];
  for (const part of inner.split(",")) {
    const item = part.trim();
    if (item.length === 0) {
      return null;
    }
    items.push(unquote(item));
  }
  return items;
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function applyKey(
  headerLines: readonly string[],
  key: string,
  op: FrontmatterPatchOperation,
): Result<{ lines: string[]; mutated: boolean }> {
  const lines = [...headerLines];
  const idx = findKeyLine(lines, key);
  const existing = idx >= 0 ? lines[idx]! : null;
  const keyPrefix = `${key}:`;

  if (op.op === "delete") {
    if (idx < 0) {
      return ok({ lines, mutated: false });
    }
    lines.splice(idx, 1);
    return ok({ lines, mutated: true });
  }

  if (op.op === "set") {
    const line = `${keyPrefix} ${serializeYamlValue(op.value)}`;
    if (idx >= 0) {
      if (lines[idx] === line) {
        return ok({ lines, mutated: false });
      }
      lines[idx] = line;
      return ok({ lines, mutated: true });
    }
    lines.push(line);
    return ok({ lines, mutated: true });
  }

  // op.op === "append"
  const item = serializeItem(op.value);
  if (existing === null) {
    lines.push(`${keyPrefix} [${item}]`);
    return ok({ lines, mutated: true });
  }
  const rawValue = existing.slice(existing.indexOf(":") + 1).trim();
  const items = parseListItems(rawValue);
  if (items === null) {
    // 既有值不是列表：拒绝（不猜测覆盖）。
    return {
      ok: false,
      error: {
        code: "ACTION_FRONTMATTER_CONFLICT" as const,
        message: `frontmatter key "${key}" 不是数组，无法 append`,
        scope: "platform" as const,
        recoverable: true,
        retryable: false,
        details: { key },
      },
    };
  }
  if (items.includes(item)) {
    return ok({ lines, mutated: false });
  }
  items.push(item);
  lines[idx] = `${keyPrefix} [${items.join(", ")}]`;
  return ok({ lines, mutated: true });
}

/**
 * 在完整文本上应用 frontmatter 补丁。纯函数；不改输入。
 * 无 frontmatter 时 set/append 会新建 `---` 块，delete 为 no-op。
 * 任何 key 都未实际变化时原样返回输入文本。
 */
export function patchFrontmatter(
  text: string,
  patch: Readonly<Record<string, FrontmatterPatchOperation>>,
): Result<string> {
  const structure = splitFrontmatter(text);
  let header = structure.headerLines;
  let changed = false;
  for (const [key, op] of Object.entries(patch)) {
    const applied = applyKey(header, key, op);
    if (!applied.ok) {
      return applied;
    }
    header = applied.value.lines;
    changed = changed || applied.value.mutated;
  }
  if (!changed) {
    return ok(text);
  }
  const body = structure.bodyLines.join("\n");
  const headerText = header.join("\n");
  return ok(`${FM_OPEN}\n${headerText}\n${FM_OPEN}\n${body}`);
}
