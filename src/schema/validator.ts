/**
 * JSON Schema 2020-12 受控子集 validator（《运行时与 SDK 协议 v1》第 1.3 节）。
 *
 * 只实现：object / array / string / number / integer / boolean / null /
 * oneOf / $ref，以及 required / additionalProperties / min-max / enum /
 * pattern / format / uniqueItems。
 * 遇到不支持的关键字必须失败，不能忽略。
 */

import type {
  ErrorCode,
  JsonValue,
  ValidationIssue,
} from "@ocs/contracts/common";
import { ERROR_CODES } from "@ocs/contracts/common";

export interface JsonSchemaBase {
  readonly title?: string;
  readonly description?: string;
  readonly default?: JsonValue;
}

export interface JsonObjectSchema extends JsonSchemaBase {
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonSchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: boolean | JsonSchema;
  readonly minProperties?: number;
  readonly maxProperties?: number;
}

export interface JsonArraySchema extends JsonSchemaBase {
  readonly type: "array";
  readonly items: JsonSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
}

export interface JsonStringSchema extends JsonSchemaBase {
  readonly type: "string";
  readonly enum?: readonly string[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly format?:
    | "date"
    | "date-time"
    | "time"
    | "uri-http"
    | "vault-path"
    | "color"
    | "icon-name"
    | "uuid";
}

export interface JsonNumberSchema extends JsonSchemaBase {
  readonly type: "number";
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
}

export interface JsonIntegerSchema extends JsonSchemaBase {
  readonly type: "integer";
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface JsonBooleanSchema extends JsonSchemaBase {
  readonly type: "boolean";
}

export interface JsonNullSchema extends JsonSchemaBase {
  readonly type: "null";
}

export interface JsonUnionSchema extends JsonSchemaBase {
  readonly oneOf: readonly JsonSchema[];
}

export interface JsonRefSchema extends JsonSchemaBase {
  readonly $ref: string;
}

export type JsonSchema =
  | JsonObjectSchema
  | JsonArraySchema
  | JsonStringSchema
  | JsonNumberSchema
  | JsonIntegerSchema
  | JsonBooleanSchema
  | JsonNullSchema
  | JsonUnionSchema
  | JsonRefSchema;

export interface SchemaValidationContext {
  /** 已解析的 $defs（同一 Schema 文档内的子定义）。 */
  readonly defs: Readonly<Record<string, JsonSchema>>;
}

export type SchemaValidationResult =
  | { ok: true; issues: readonly ValidationIssue[] }
  | { ok: false; issues: readonly ValidationIssue[] };

const ALLOWED_KEYWORDS = new Set([
  "title",
  "description",
  "default",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "minProperties",
  "maxProperties",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "enum",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "oneOf",
  "$ref",
  "$defs",
]);

/**
 * 编译 Schema：校验关键字、解析 `$ref`（只允许 `#/$defs/...`）。
 * 遇到不支持的关键字返回错误列表。
 */
export function compileSchema(
  schema: JsonSchema,
  defs: Readonly<Record<string, JsonSchema>> = extractDefs(schema),
): SchemaValidationResult {
  const issues: ValidationIssue[] = [];
  walkCompile(schema, defs, issues, "$");
  return { ok: issues.length === 0, issues };
}

function extractDefs(schema: JsonSchema): Record<string, JsonSchema> {
  const defs: Record<string, JsonSchema> = {};
  const raw = schema as unknown as JsonValue;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const d = (raw as { $defs?: Record<string, JsonSchema> }).$defs;
    if (d && typeof d === "object") {
      for (const key of Object.keys(d)) {
        defs[key] = d[key]!;
      }
    }
  }
  return defs;
}

function walkCompile(
  schema: JsonSchema,
  defs: Readonly<Record<string, JsonSchema>>,
  issues: ValidationIssue[],
  pointer: string,
): void {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    issues.push({
      pointer,
      code: ERROR_CODES.DOC_SCHEMA_INVALID,
      message: "Schema 必须是对象",
      severity: "error",
    });
    return;
  }
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_KEYWORDS.has(key)) {
      issues.push({
        pointer: `${pointer}/${key}`,
        code: ERROR_CODES.DOC_SCHEMA_INVALID,
        message: `不支持的关键字: ${key}`,
        severity: "error",
      });
    }
  }
  if ("$ref" in schema) {
    const ref = schema.$ref;
    if (!ref.startsWith("#/$defs/")) {
      issues.push({
        pointer,
        code: ERROR_CODES.DOC_SCHEMA_INVALID,
        message: `不支持的 $ref: ${ref}`,
        severity: "error",
      });
      return;
    }
    const name = ref.slice("#/$defs/".length);
    const target = defs[name];
    if (!target) {
      issues.push({
        pointer,
        code: ERROR_CODES.DOC_SCHEMA_INVALID,
        message: `无法解析 $ref: ${ref}`,
        severity: "error",
      });
    }
    return;
  }
  if ("type" in schema && typeof schema.type === "string") {
    const typeName = schema.type;
    switch (typeName) {
      case "object": {
        const s = schema as JsonObjectSchema;
        for (const key of Object.keys(s.properties)) {
          walkCompile(s.properties[key]!, defs, issues, `${pointer}/properties/${key}`);
        }
        if (s.additionalProperties && typeof s.additionalProperties === "object") {
          walkCompile(s.additionalProperties, defs, issues, `${pointer}/additionalProperties`);
        }
        break;
      }
      case "array": {
        const s = schema as JsonArraySchema;
        walkCompile(s.items, defs, issues, `${pointer}/items`);
        break;
      }
      case "string":
      case "number":
      case "integer":
      case "boolean":
      case "null":
        break;
      default:
        issues.push({
          pointer: `${pointer}/type`,
          code: ERROR_CODES.DOC_SCHEMA_INVALID,
          message: `未知 type: ${typeName}`,
          severity: "error",
        });
    }
  } else if ("oneOf" in schema) {
    const s = schema as JsonUnionSchema;
    s.oneOf.forEach((sub, i) => walkCompile(sub, defs, issues, `${pointer}/oneOf/${i}`));
  } else {
    issues.push({
      pointer,
      code: ERROR_CODES.DOC_SCHEMA_INVALID,
      message: "Schema 必须包含 type 或 $ref 或 oneOf",
      severity: "error",
    });
  }
}

/**
 * 校验 value 是否符合 schema。
 * `issues` 收集 error；`warnings` 只用于可选非致命提示。
 */
export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  defs: Readonly<Record<string, JsonSchema>>,
  issues: ValidationIssue[],
  pointer = "$",
): void {
  if ("$ref" in schema) {
    const name = schema.$ref.slice("#/$defs/".length);
    const target = defs[name];
    if (!target) {
      issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: `无法解析 $ref`, severity: "error" });
      return;
    }
    validateAgainstSchema(value, target, defs, issues, pointer);
    return;
  }
  if ("oneOf" in schema) {
    const s = schema as JsonUnionSchema;
    let matched = false;
    for (let i = 0; i < s.oneOf.length; i++) {
      const branchIssues: ValidationIssue[] = [];
      validateAgainstSchema(value, s.oneOf[i]!, defs, branchIssues, pointer);
      if (branchIssues.length === 0) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      issues.push({
        pointer,
        code: ERROR_CODES.DOC_SCHEMA_INVALID,
        message: "不匹配 oneOf 任何分支",
        severity: "error",
      });
    }
    return;
  }
  const type = (schema as { type?: string }).type;
  if (type === undefined) {
    issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "Schema 缺少 type", severity: "error" });
    return;
  }
  const child = (p: string) => (pointer === "$" ? p : `${pointer}${p}`);
  switch (type) {
    case "object": {
      const s = schema as JsonObjectSchema;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "应为 object", severity: "error" });
        return;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (s.minProperties !== undefined && keys.length < s.minProperties) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "属性数少于 minProperties", severity: "error" });
      }
      if (s.maxProperties !== undefined && keys.length > s.maxProperties) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "属性数多于 maxProperties", severity: "error" });
      }
      for (const key of s.required) {
        if (!(key in obj)) {
          issues.push({ pointer: child(`/${escapePointer(key)}`), code: ERROR_CODES.DOC_SCHEMA_INVALID, message: `缺少必填字段: ${key}`, severity: "error" });
        }
      }
      for (const key of keys) {
        const propSchema = s.properties[key];
        if (propSchema) {
          validateAgainstSchema(obj[key], propSchema, defs, issues, child(`/${escapePointer(key)}`));
        } else if (s.additionalProperties !== undefined && s.additionalProperties !== true) {
          if (s.additionalProperties === false) {
            issues.push({ pointer: child(`/${escapePointer(key)}`), code: ERROR_CODES.DOC_SCHEMA_INVALID, message: `多余字段: ${key}`, severity: "error" });
          } else {
            validateAgainstSchema(obj[key], s.additionalProperties, defs, issues, child(`/${escapePointer(key)}`));
          }
        }
      }
      break;
    }
    case "array": {
      const s = schema as JsonArraySchema;
      if (!Array.isArray(value)) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "应为 array", severity: "error" });
        return;
      }
      if (s.minItems !== undefined && value.length < s.minItems) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "数组少于 minItems", severity: "error" });
      }
      if (s.maxItems !== undefined && value.length > s.maxItems) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "数组多于 maxItems", severity: "error" });
      }
      if (s.uniqueItems) {
        for (let i = 0; i < value.length; i++) {
          for (let j = i + 1; j < value.length; j++) {
            if (jsonDeepEqual(value[i], value[j])) {
              issues.push({ pointer: child(`/${i}`), code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "数组项重复", severity: "error" });
            }
          }
        }
      }
      value.forEach((item, i) => validateAgainstSchema(item, s.items, defs, issues, child(`/${i}`)));
      break;
    }
    case "string": {
      const s = schema as JsonStringSchema;
      if (typeof value !== "string") {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "应为 string", severity: "error" });
        return;
      }
      const len = Array.from(value).length;
      if (s.enum && !s.enum.includes(value)) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "不在 enum 中", severity: "error" });
      }
      if (s.minLength !== undefined && len < s.minLength) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "字符串过短", severity: "error" });
      }
      if (s.maxLength !== undefined && len > s.maxLength) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "字符串过长", severity: "error" });
      }
      if (s.pattern !== undefined && !new RegExp(s.pattern).test(value)) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "不匹配 pattern", severity: "error" });
      }
      if (s.format !== undefined && !checkFormat(s.format, value)) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: `格式不合法: ${s.format}`, severity: "error" });
      }
      break;
    }
    case "number": {
      const s = schema as JsonNumberSchema;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "应为有限 number", severity: "error" });
        return;
      }
      if (s.minimum !== undefined && value < s.minimum) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "小于 minimum", severity: "error" });
      }
      if (s.maximum !== undefined && value > s.maximum) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "大于 maximum", severity: "error" });
      }
      if (s.exclusiveMinimum !== undefined && value <= s.exclusiveMinimum) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "不大于 exclusiveMinimum", severity: "error" });
      }
      if (s.exclusiveMaximum !== undefined && value >= s.exclusiveMaximum) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "不小于 exclusiveMaximum", severity: "error" });
      }
      break;
    }
    case "integer": {
      const s = schema as JsonIntegerSchema;
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "应为安全整数", severity: "error" });
        return;
      }
      if (s.minimum !== undefined && value < s.minimum) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "小于 minimum", severity: "error" });
      }
      if (s.maximum !== undefined && value > s.maximum) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "大于 maximum", severity: "error" });
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "应为 boolean", severity: "error" });
      }
      break;
    }
    case "null": {
      if (value !== null) {
        issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: "应为 null", severity: "error" });
      }
      break;
    }
    default: {
      issues.push({ pointer, code: ERROR_CODES.DOC_SCHEMA_INVALID, message: `未知 type: ${type}`, severity: "error" });
    }
  }
}

function checkFormat(format: string, value: string): boolean {
  switch (format) {
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
    case "date-time":
      return !Number.isNaN(Date.parse(value));
    case "time":
      return /^\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(value);
    case "uri-http":
      return /^https?:\/\/\S+$/.test(value);
    case "vault-path":
      return (
        value.length > 0 &&
        !value.startsWith("/") &&
        !value.includes("\u0000") &&
        !/\.\.(\/|$)/.test(value)
      );
    case "color":
      return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value);
    case "icon-name":
      return /^[a-z0-9-]+$/.test(value);
    case "uuid":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
    default:
      return true;
  }
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => jsonDeepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => jsonDeepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

export type { ErrorCode };
