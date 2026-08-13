/**
 * 安全表达式求值器（《运行时与 SDK 协议 v1》第 6.3 节）。
 *
 * 只求值 ExprV1 JSON AST，不执行任何代码字符串（无 eval / new Function）。
 * 预算上限（协议 13.5）：
 *   - AST 节点总数 <= 256
 *   - 嵌套深度 <= 32
 *   - call 操作总数 <= 10_000
 *   - 输出序列化 <= 1 MiB
 *
 * 上下文名称（document/currentFile/node/state/event/outputs）由调用方
 * 以 `Readonly<Record<string, JsonValue>>` 注入。
 */
import type {
  BuiltinFunctionV1,
  ErrorCode,
  ExprV1,
  JsonObject,
  JsonValue,
  Result,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";

export const EXPR_MAX_NODES = 256;
export const EXPR_MAX_DEPTH = 32;
export const EXPR_MAX_OPS = 10_000;
export const EXPR_MAX_OUTPUT_BYTES = 1024 * 1024;

export type ExpressionContext = Readonly<Record<string, JsonValue>>;

function exprError(
  code: ErrorCode,
  message: string,
  details?: JsonObject,
): { ok: false; error: { code: ErrorCode; message: string; scope: "binding"; recoverable: boolean; retryable: boolean; details?: JsonObject } } {
  return {
    ok: false,
    error: {
      code,
      message,
      scope: "binding",
      recoverable: false,
      retryable: false,
      details,
    },
  };
}

/** 判断两个 JSON 值是否深度相等（call eq/neq 语义）。 */
export function jsonValueEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!jsonValueEqual(a[i]!, b[i]!)) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    for (const key of ka) {
      if (!(key in (b as object))) return false;
      if (!jsonValueEqual((a as JsonObject)[key]!, (b as JsonObject)[key]!)) return false;
    }
    return true;
  }
  return false;
}

function jsonByteLength(value: JsonValue): number {
  const text = JSON.stringify(value);
  return text === undefined ? 0 : text.length;
}

/**
 * RFC 6901 JSON Pointer 解析（支持 ~0/~1 转义）。
 * 空指针 "" 返回根；非法指针返回 EXPR_PATH_NOT_FOUND。
 */
export function resolveJsonPointer(root: JsonValue, pointer: string): Result<JsonValue> {
  if (pointer === "") {
    return { ok: true, value: root };
  }
  if (!pointer.startsWith("/")) {
    return exprError(ERROR_CODES.EXPR_PATH_NOT_FOUND, `非法 JSON Pointer: ${pointer}`);
  }
  let current: JsonValue = root;
  for (const raw of pointer.slice(1).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current === null || typeof current !== "object") {
      return exprError(ERROR_CODES.EXPR_PATH_NOT_FOUND, `路径不存在: ${pointer}`);
    }
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment)) {
        return exprError(ERROR_CODES.EXPR_PATH_NOT_FOUND, `数组索引非法: ${segment}`);
      }
      const index = Number(segment);
      if (index >= current.length) {
        return exprError(ERROR_CODES.EXPR_PATH_NOT_FOUND, `路径不存在: ${pointer}`);
      }
      current = current[index]!;
    } else {
      const obj = current as JsonObject;
      if (!(segment in obj)) {
        return exprError(ERROR_CODES.EXPR_PATH_NOT_FOUND, `路径不存在: ${pointer}`);
      }
      current = obj[segment]!;
    }
  }
  return { ok: true, value: current };
}

interface Budget {
  nodes: number;
  ops: number;
}

function expectNumber(value: JsonValue, fn: BuiltinFunctionV1): Result<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return exprError(ERROR_CODES.EXPR_TYPE_MISMATCH, `${fn} 需要 number 参数`);
  }
  return { ok: true, value };
}

function expectString(value: JsonValue, fn: BuiltinFunctionV1): Result<string> {
  if (typeof value !== "string") {
    return exprError(ERROR_CODES.EXPR_TYPE_MISMATCH, `${fn} 需要 string 参数`);
  }
  return { ok: true, value };
}

function expectBoolean(value: JsonValue, fn: BuiltinFunctionV1): Result<boolean> {
  if (typeof value !== "boolean") {
    return exprError(ERROR_CODES.EXPR_TYPE_MISMATCH, `${fn} 需要 boolean 参数`);
  }
  return { ok: true, value };
}

function callFunction(
  fn: BuiltinFunctionV1,
  args: readonly JsonValue[],
): Result<JsonValue> {
  switch (fn) {
    case "eq":
      return { ok: true, value: jsonValueEqual(args[0] ?? null, args[1] ?? null) };
    case "neq":
      return { ok: true, value: !jsonValueEqual(args[0] ?? null, args[1] ?? null) };
    case "and": {
      for (const arg of args) {
        const b = expectBoolean(arg, fn);
        if (!b.ok) return b;
        if (!b.value) return { ok: true, value: false };
      }
      return { ok: true, value: true };
    }
    case "or": {
      for (const arg of args) {
        const b = expectBoolean(arg, fn);
        if (!b.ok) return b;
        if (b.value) return { ok: true, value: true };
      }
      return { ok: true, value: false };
    }
    case "not": {
      const b = expectBoolean(args[0] ?? null, fn);
      if (!b.ok) return b;
      return { ok: true, value: !b.value };
    }
    case "coalesce": {
      for (const arg of args) {
        if (arg !== null) return { ok: true, value: arg };
      }
      return { ok: true, value: null };
    }
    case "concat": {
      let out = "";
      for (const arg of args) {
        const s = expectString(arg, fn);
        if (!s.ok) return s;
        out += s.value;
      }
      return { ok: true, value: out };
    }
    case "lower": {
      const s = expectString(args[0] ?? null, fn);
      if (!s.ok) return s;
      return { ok: true, value: s.value.toLowerCase() };
    }
    case "upper": {
      const s = expectString(args[0] ?? null, fn);
      if (!s.ok) return s;
      return { ok: true, value: s.value.toUpperCase() };
    }
    case "trim": {
      const s = expectString(args[0] ?? null, fn);
      if (!s.ok) return s;
      return { ok: true, value: s.value.trim() };
    }
    case "length": {
      const s = expectString(args[0] ?? null, fn);
      if (!s.ok) return s;
      return { ok: true, value: Array.from(s.value).length };
    }
    case "includes": {
      const haystack = expectString(args[0] ?? null, fn);
      if (!haystack.ok) return haystack;
      const needle = expectString(args[1] ?? null, fn);
      if (!needle.ok) return needle;
      return { ok: true, value: haystack.value.includes(needle.value) };
    }
    case "add": {
      const a = expectNumber(args[0] ?? null, fn);
      if (!a.ok) return a;
      const b = expectNumber(args[1] ?? null, fn);
      if (!b.ok) return b;
      return { ok: true, value: a.value + b.value };
    }
    case "sub": {
      const a = expectNumber(args[0] ?? null, fn);
      if (!a.ok) return a;
      const b = expectNumber(args[1] ?? null, fn);
      if (!b.ok) return b;
      return { ok: true, value: a.value - b.value };
    }
    case "mul": {
      const a = expectNumber(args[0] ?? null, fn);
      if (!a.ok) return a;
      const b = expectNumber(args[1] ?? null, fn);
      if (!b.ok) return b;
      return { ok: true, value: a.value * b.value };
    }
    case "div": {
      const a = expectNumber(args[0] ?? null, fn);
      if (!a.ok) return a;
      const b = expectNumber(args[1] ?? null, fn);
      if (!b.ok) return b;
      if (b.value === 0) {
        return exprError(ERROR_CODES.EXPR_DIVIDE_BY_ZERO, "除数为零");
      }
      return { ok: true, value: a.value / b.value };
    }
    case "round": {
      const n = expectNumber(args[0] ?? null, fn);
      if (!n.ok) return n;
      return { ok: true, value: Math.round(n.value) };
    }
    case "gt": {
      const a = expectNumber(args[0] ?? null, fn);
      if (!a.ok) return a;
      const b = expectNumber(args[1] ?? null, fn);
      if (!b.ok) return b;
      return { ok: true, value: a.value > b.value };
    }
    case "gte": {
      const a = expectNumber(args[0] ?? null, fn);
      if (!a.ok) return a;
      const b = expectNumber(args[1] ?? null, fn);
      if (!b.ok) return b;
      return { ok: true, value: a.value >= b.value };
    }
    case "lt": {
      const a = expectNumber(args[0] ?? null, fn);
      if (!a.ok) return a;
      const b = expectNumber(args[1] ?? null, fn);
      if (!b.ok) return b;
      return { ok: true, value: a.value < b.value };
    }
    case "lte": {
      const a = expectNumber(args[0] ?? null, fn);
      if (!a.ok) return a;
      const b = expectNumber(args[1] ?? null, fn);
      if (!b.ok) return b;
      return { ok: true, value: a.value <= b.value };
    }
    case "min": {
      let best: number | null = null;
      for (const arg of args) {
        const n = expectNumber(arg, fn);
        if (!n.ok) return n;
        if (best === null || n.value < best) best = n.value;
      }
      return { ok: true, value: best };
    }
    case "max": {
      let best: number | null = null;
      for (const arg of args) {
        const n = expectNumber(arg, fn);
        if (!n.ok) return n;
        if (best === null || n.value > best) best = n.value;
      }
      return { ok: true, value: best };
    }
    case "formatDate":
      // Phase 2：需要 locale/时区感知的日期格式化；MVP 不实现。
      return exprError(ERROR_CODES.EXPR_SCHEMA_INVALID, "formatDate 尚未实现（Phase 2）");
    default: {
      const exhaustive: never = fn;
      return exprError(ERROR_CODES.EXPR_SCHEMA_INVALID, `未知函数: ${String(exhaustive)}`);
    }
  }
}

function evalNode(
  expr: ExprV1,
  context: ExpressionContext,
  budget: Budget,
  depth: number,
): Result<JsonValue> {
  budget.nodes += 1;
  if (budget.nodes > EXPR_MAX_NODES) {
    return exprError(ERROR_CODES.EXPR_BUDGET_EXCEEDED, "表达式节点数超过 256");
  }
  if (depth > EXPR_MAX_DEPTH) {
    return exprError(ERROR_CODES.EXPR_BUDGET_EXCEEDED, "表达式深度超过 32");
  }
  if (jsonByteLength(expr as unknown as JsonValue) > EXPR_MAX_OUTPUT_BYTES) {
    return exprError(ERROR_CODES.EXPR_BUDGET_EXCEEDED, "表达式输出超过 1 MiB");
  }
  switch (expr.op) {
    case "literal":
      return { ok: true, value: expr.value };
    case "context": {
      const value = context[expr.name];
      if (value === undefined) {
        return exprError(ERROR_CODES.EXPR_CONTEXT_UNAVAILABLE, `上下文不可用: ${expr.name}`);
      }
      return { ok: true, value };
    }
    case "source":
      // Phase 0：DataSource 值由 Phase 2 的 Query Store 提供。
      return exprError(
        ERROR_CODES.EXPR_CONTEXT_UNAVAILABLE,
        `DataSource 上下文（${expr.sourceId}）尚未就绪（Phase 2 seam）`,
      );
    case "get": {
      const base = evalNode(expr.value, context, budget, depth + 1);
      if (!base.ok) return base;
      return resolveJsonPointer(base.value, expr.pointer);
    }
    case "if": {
      const condition = evalNode(expr.condition, context, budget, depth + 1);
      if (!condition.ok) return condition;
      if (condition.value !== false && condition.value !== null) {
        return evalNode(expr.then, context, budget, depth + 1);
      }
      return evalNode(expr.else, context, budget, depth + 1);
    }
    case "array": {
      const items: JsonValue[] = [];
      for (const item of expr.items) {
        const r = evalNode(item, context, budget, depth + 1);
        if (!r.ok) return r;
        items.push(r.value);
      }
      return { ok: true, value: items };
    }
    case "object": {
      const out: JsonObject = {};
      for (const key of Object.keys(expr.entries)) {
        const r = evalNode(expr.entries[key]!, context, budget, depth + 1);
        if (!r.ok) return r;
        out[key] = r.value;
      }
      return { ok: true, value: out };
    }
    case "call": {
      budget.ops += 1;
      if (budget.ops > EXPR_MAX_OPS) {
        return exprError(ERROR_CODES.EXPR_BUDGET_EXCEEDED, "表达式操作数超过 10,000");
      }
      const args: JsonValue[] = [];
      for (const arg of expr.args) {
        const r = evalNode(arg, context, budget, depth + 1);
        if (!r.ok) return r;
        args.push(r.value);
      }
      return callFunction(expr.fn, args);
    }
    default: {
      const exhaustive: never = expr;
      return exprError(ERROR_CODES.EXPR_SCHEMA_INVALID, `未知表达式节点: ${String(exhaustive)}`);
    }
  }
}

/**
 * 求值 ExprV1。context 键为 ExpressionContextNameV1（document/currentFile/
 * node/state/event/outputs）。错误为 ProtocolError 形状（scope: binding）。
 */
export function evaluateExpr(
  expr: ExprV1,
  context: ExpressionContext = {},
): Result<JsonValue> {
  const budget: Budget = { nodes: 0, ops: 0 };
  return evalNode(expr, context, budget, 0);
}
