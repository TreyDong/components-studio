/**
 * MVP Action 共享 Schema 助手（《运行时与 SDK 协议 v1》第 8.2–8.3 节）。
 *
 * 注意：schema/validator 的 compileSchema 不防递归，因此这里的所有
 * “任意 JSON” schema 都写成有界的一层展开（数组不能嵌套数组），
 * 深层的 Expr 内容正确性由运行期 evaluateExpr 校验（EXPR_SCHEMA_INVALID）。
 */
import type { ErrorCode, JsonObject, ProtocolError } from "@ocs/contracts";
import type { JsonObjectSchema, JsonSchema } from "../../schema/validator";

/** 任意标量或对象（数组分支见 anyJsonLoose）。非递归。 */
export const anyScalarOrObject: JsonSchema = {
  oneOf: [
    { type: "string" },
    { type: "number" },
    { type: "integer" },
    { type: "boolean" },
    { type: "null" },
    { type: "object", properties: {}, required: [], additionalProperties: true },
  ],
};

/** 任意 JSON 值（数组内不能再嵌套数组）。非递归。 */
export const anyJsonLoose: JsonSchema = {
  oneOf: [anyScalarOrObject, { type: "array", items: anyScalarOrObject }],
};

export function nullable(schema: JsonSchema): JsonSchema {
  return { oneOf: [schema, { type: "null" }] };
}

/** ExprV1 形状（嵌套 Expr 字段用 anyJsonLoose 弱校验）。 */
export const exprSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      properties: { op: { type: "string", enum: ["literal"] }, value: anyJsonLoose },
      required: ["op", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["context"] },
        name: {
          type: "string",
          enum: ["document", "currentFile", "node", "state", "event", "outputs"],
        },
      },
      required: ["op", "name"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { op: { type: "string", enum: ["source"] }, sourceId: { type: "string" } },
      required: ["op", "sourceId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { op: { type: "string", enum: ["get"] }, value: anyJsonLoose, pointer: { type: "string" } },
      required: ["op", "value", "pointer"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["call"] },
        fn: { type: "string" },
        args: { type: "array", items: anyJsonLoose },
      },
      required: ["op", "fn", "args"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["if"] },
        condition: anyJsonLoose,
        then: anyJsonLoose,
        else: anyJsonLoose,
      },
      required: ["op", "condition", "then", "else"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { op: { type: "string", enum: ["array"] }, items: { type: "array", items: anyJsonLoose } },
      required: ["op", "items"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["object"] },
        entries: { type: "object", properties: {}, required: [], additionalProperties: anyJsonLoose },
      },
      required: ["op", "entries"],
      additionalProperties: false,
    },
  ],
};

export const confirmationSchema: JsonSchema = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["never", "if-untrusted", "always"] },
    title: nullable({ type: "string" }),
    message: nullable({ type: "string" }),
    confirmLabel: nullable({ type: "string" }),
    cancelLabel: nullable({ type: "string" }),
    danger: { type: "boolean" },
  },
  required: ["mode", "title", "message", "confirmLabel", "cancelLabel", "danger"],
  additionalProperties: false,
};

export const extensionsSchema: JsonSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: true,
};

/** BaseActionSpec 公共字段（8.2 节）。 */
export function baseActionProperties(type: string): Record<string, JsonSchema> {
  return {
    id: { type: "string", format: "uuid" },
    type: { type: "string", enum: [type] },
    specVersion: { type: "integer", minimum: 1 },
    enabled: { type: "boolean" },
    label: nullable({ type: "string" }),
    when: nullable(exprSchema),
    resultKey: nullable({ type: "string", pattern: "^[a-z][a-zA-Z0-9_]{0,63}$" }),
    timeoutMs: { type: "integer", minimum: 100, maximum: 60_000 },
    confirmation: confirmationSchema,
    onError: { type: "string", enum: ["stop", "continue"] },
    extensions: extensionsSchema,
  };
}

export function actionError(code: ErrorCode, message: string, cause?: unknown): ProtocolError {
  return {
    code,
    message,
    scope: "action",
    recoverable: false,
    retryable: false,
    ...(cause !== undefined ? { cause } : {}),
  };
}

export function platformError(code: ErrorCode, message: string, cause?: unknown): ProtocolError {
  return {
    code,
    message,
    scope: "platform",
    recoverable: false,
    retryable: false,
    ...(cause !== undefined ? { cause } : {}),
  };
}

/** 由 Discriminator 分支构造完整 JsonObjectSchema。 */
export function objectSchema(
  properties: Record<string, JsonSchema>,
  required: readonly string[],
): JsonObjectSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export type { JsonObject };
