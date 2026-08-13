/**
 * V1 文档结构校验（《文档与会话协议 v1》第 3、6 章）。
 * 负责通用结构与数值边界；组件 Props/Slot 的 Definition 级校验由 Codec
 * 通过 CodecRegistry 执行，树不变量见 invariants.ts。
 */

import type {
  ComponentsDocumentV1,
  ValidationIssue,
  ValidationResult,
} from "@ocs/contracts";
import {
  CLASS_NAME_PATTERN,
  DOCUMENT_LIMITS,
  ERROR_CODES,
  isLiteralColor,
  isSafeInteger,
  isUtcIsoDateTime,
  RESULT_KEY_PATTERN,
  SLOT_NAME_PATTERN,
  TYPE_NAMESPACE_PATTERN,
  UUID_V4_PATTERN,
} from "@ocs/contracts";
import type { JsonValue } from "@ocs/contracts";

const CORE_LAYOUT_TYPE = "core.layout" as const;

const KNOWN_ACTION_TYPES: Record<string, true> = {
  "file.open": true,
  "url.open": true,
  "command.execute": true,
  "file.create": true,
  "frontmatter.update": true,
  "markdown.task.update": true,
  "clipboard.copy": true,
  "notice.show": true,
};

const EXPR_OPS: Record<string, true> = {
  literal: true,
  context: true,
  source: true,
  get: true,
  call: true,
  if: true,
  array: true,
  object: true,
};

const BUILTIN_FNS: Record<string, true> = {
  eq: true, neq: true, gt: true, gte: true, lt: true, lte: true,
  and: true, or: true, not: true, coalesce: true,
  concat: true, lower: true, upper: true, trim: true, length: true, includes: true,
  add: true, sub: true, mul: true, div: true, round: true, min: true, max: true,
  formatDate: true,
};

const EXPR_CONTEXT_NAMES: Record<string, true> = {
  document: true,
  currentFile: true,
  node: true,
  state: true,
  event: true,
  outputs: true,
};

const ON_ERROR_VALUES: Record<string, true> = {
  stop: true,
  continue: true,
};

const CONFIRMATION_MODES: Record<string, true> = {
  never: true,
  "if-untrusted": true,
  always: true,
};

const REFRESH_MODES: Record<string, true> = {
  "on-vault-change": true,
  manual: true,
  interval: true,
};

interface IssueCollector {
  issues: ValidationIssue[];
  add(pointer: string, code: ValidationIssue["code"], message: string): void;
}

function collector(): IssueCollector {
  return {
    issues: [],
    add(pointer, code, message) {
      this.issues.push({ pointer, code, message, severity: "error" });
    },
  };
}

function isObject(v: unknown): v is Record<string, JsonValue> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isPlainObject(v: unknown): v is Record<string, JsonValue> {
  if (!isObject(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** 深冻结辅助：把解析后的文档转为不可变快照。 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * 校验解析后的 JsonValue 是否为合法 V1 文档（结构 + 数值边界）。
 * 树不变量与 Definition 级校验不在此处。
 */
export function validateDocumentShape(value: unknown): ValidationResult<ComponentsDocumentV1> {
  const c = collector();

  if (!isPlainObject(value)) {
    c.add("$", ERROR_CODES.DOC_SCHEMA_INVALID, "顶层必须是 JSON 对象");
    return { ok: false, issues: c.issues };
  }

  const topKeys = Object.keys(value);
  const allowedTop: Record<string, true> = {
    kind: true, formatVersion: true, documentId: true, revision: true,
    createdAt: true, updatedAt: true, rootId: true, nodes: true,
    dataSources: true, permissions: true, metadata: true, extensions: true,
  };
  for (const k of topKeys) {
    if (!allowedTop[k]) {
      c.add(`/${k}`, ERROR_CODES.DOC_SCHEMA_INVALID, `多余顶层字段: ${k}`);
    }
  }
  for (const k of Object.keys(allowedTop)) {
    if (!(k in value)) {
      c.add(`/${k}`, ERROR_CODES.DOC_SCHEMA_INVALID, `缺少必填字段: ${k}`);
    }
  }

  if (value.kind !== "components-studio/document") {
    c.add("/kind", ERROR_CODES.DOC_KIND_MISMATCH, `kind 必须为 components-studio/document`);
  }
  if (value.formatVersion !== 1) {
    if (typeof value.formatVersion === "number" && value.formatVersion > 1) {
      c.add("/formatVersion", ERROR_CODES.DOC_FORMAT_UNSUPPORTED_FUTURE, "未来 formatVersion，整份只读");
    } else {
      c.add("/formatVersion", ERROR_CODES.DOC_SCHEMA_INVALID, "formatVersion 必须为 1");
    }
  }
  if (typeof value.documentId !== "string" || !UUID_V4_PATTERN.test(value.documentId)) {
    c.add("/documentId", ERROR_CODES.DOC_ID_INVALID, "documentId 必须是小写 UUID v4");
  }
  if (typeof value.revision !== "number" || !isSafeInteger(value.revision) || value.revision < 0) {
    c.add("/revision", ERROR_CODES.DOC_SCHEMA_INVALID, "revision 必须是非负安全整数");
  }
  if (typeof value.createdAt !== "string" || !isUtcIsoDateTime(value.createdAt)) {
    c.add("/createdAt", ERROR_CODES.DOC_SCHEMA_INVALID, "createdAt 必须是含毫秒的 UTC ISO 8601");
  }
  if (typeof value.updatedAt !== "string" || !isUtcIsoDateTime(value.updatedAt)) {
    c.add("/updatedAt", ERROR_CODES.DOC_SCHEMA_INVALID, "updatedAt 必须是含毫秒的 UTC ISO 8601");
  }
  if (
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isUtcIsoDateTime(value.createdAt) &&
    isUtcIsoDateTime(value.updatedAt) &&
    Date.parse(value.updatedAt) < Date.parse(value.createdAt)
  ) {
    c.add("/updatedAt", ERROR_CODES.DOC_SCHEMA_INVALID, "updatedAt 不得早于 createdAt");
  }
  if (typeof value.rootId !== "string" || !UUID_V4_PATTERN.test(value.rootId)) {
    c.add("/rootId", ERROR_CODES.DOC_ID_INVALID, "rootId 必须是 UUID v4");
  }
  if (!isObject(value.nodes) || Array.isArray(value.nodes)) {
    c.add("/nodes", ERROR_CODES.DOC_SCHEMA_INVALID, "nodes 必须是对象");
  }
  if (!isObject(value.dataSources) || Array.isArray(value.dataSources)) {
    c.add("/dataSources", ERROR_CODES.DOC_SCHEMA_INVALID, "dataSources 必须是对象");
  }
  if (!isObject(value.extensions)) {
    c.add("/extensions", ERROR_CODES.DOC_SCHEMA_INVALID, "extensions 必须是对象");
  }

  const nodeCount = Object.keys(value.nodes ?? {}).length;
  if (nodeCount > DOCUMENT_LIMITS.maxNodes) {
    c.add("/nodes", ERROR_CODES.DOC_TOO_LARGE, "节点数超过上限");
  }
  const dsCount = Object.keys(value.dataSources ?? {}).length;
  if (dsCount > DOCUMENT_LIMITS.maxDataSources) {
    c.add("/dataSources", ERROR_CODES.DOC_TOO_LARGE, "数据源数超过上限");
  }

  // nodes
  if (isObject(value.nodes)) {
    for (const key of Object.keys(value.nodes)) {
      const node = value.nodes[key];
      validateNode(node, `$/nodes/${escapeSeg(key)}`, c);
      if (isObject(node) && typeof node.id === "string" && node.id !== key) {
        c.add(`/nodes/${escapeSeg(key)}`, ERROR_CODES.DOC_ID_KEY_MISMATCH, "nodes 键必须等于 node.id");
      }
    }
  }

  // root
  const rootId = typeof value.rootId === "string" ? value.rootId : null;
  if (rootId && isObject(value.nodes) && !(rootId in value.nodes)) {
    c.add("/rootId", ERROR_CODES.DOC_ROOT_MISSING, "rootId 必须存在于 nodes");
  } else if (rootId && isObject(value.nodes) && isObject(value.nodes[rootId])) {
    const root = value.nodes[rootId] as { type?: unknown };
    if (root.type !== CORE_LAYOUT_TYPE) {
      c.add("/rootId", ERROR_CODES.DOC_ROOT_TYPE_INVALID, "Root 类型必须精确为 core.layout");
    }
  }

  // dataSources
  if (isObject(value.dataSources)) {
    for (const key of Object.keys(value.dataSources)) {
      const ds = value.dataSources[key];
      validateDataSource(ds, `$/dataSources/${escapeSeg(key)}`, c);
      if (isObject(ds) && typeof ds.id === "string" && ds.id !== key) {
        c.add(`/dataSources/${escapeSeg(key)}`, ERROR_CODES.DOC_ID_KEY_MISMATCH, "dataSources 键必须等于声明 id");
      }
    }
  }

  // permissions
  validatePermissions(value.permissions, "/permissions", c);

  // metadata
  validateMetadata(value.metadata, "/metadata", c);

  // extensions
  validateExtensionKeys(value.extensions, "/extensions", c);

  if (c.issues.length > 0) {
    return { ok: false, issues: c.issues };
  }
  return { ok: true, value: value as unknown as ComponentsDocumentV1, warnings: [] };
}

function validateNode(node: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(node)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "节点必须是对象");
    return;
  }
  const required: Record<string, true> = {
    id: true, type: true, specVersion: true, enabled: true, label: true,
    props: true, style: true, slots: true, bindings: true, events: true, extensions: true,
  };
  for (const k of Object.keys(required)) {
    if (!(k in node)) c.add(`${pointer}/${k}`, ERROR_CODES.DOC_SCHEMA_INVALID, `缺少必填字段: ${k}`);
  }
  for (const k of Object.keys(node)) {
    if (!required[k]) c.add(`${pointer}/${k}`, ERROR_CODES.DOC_SCHEMA_INVALID, `多余字段: ${k}`);
  }
  if (typeof node.id !== "string" || !UUID_V4_PATTERN.test(node.id)) {
    c.add(`${pointer}/id`, ERROR_CODES.DOC_ID_INVALID, "节点 id 必须是小写 UUID v4");
  }
  if (typeof node.type !== "string" || !TYPE_NAMESPACE_PATTERN.test(node.type)) {
    c.add(`${pointer}/type`, ERROR_CODES.DOC_SCHEMA_INVALID, "type 必须匹配命名空间类型模式");
  }
  if (typeof node.specVersion !== "number" || !isSafeInteger(node.specVersion) || node.specVersion < 1) {
    c.add(`${pointer}/specVersion`, ERROR_CODES.DOC_SCHEMA_INVALID, "specVersion 必须是 >=1 的安全整数");
  }
  if (typeof node.enabled !== "boolean") {
    c.add(`${pointer}/enabled`, ERROR_CODES.DOC_SCHEMA_INVALID, "enabled 必须是 boolean");
  }
  if (node.label !== null && (typeof node.label !== "string" || Array.from(node.label).length > 120)) {
    c.add(`${pointer}/label`, ERROR_CODES.DOC_SCHEMA_INVALID, "label 必须为 null 或 <=120 code points");
  }
  if (!isPlainObject(node.props)) {
    c.add(`${pointer}/props`, ERROR_CODES.DOC_SCHEMA_INVALID, "props 必须是 JSON 对象");
  } else {
    const bytes = roughJsonSize(node.props);
    if (bytes > DOCUMENT_LIMITS.maxPropsBytes) {
      c.add(`${pointer}/props`, ERROR_CODES.DOC_TOO_LARGE, "单节点 Props 超过 1 MiB");
    }
  }
  validateStyle(node.style, `${pointer}/style`, c);
  validateSlots(node.slots, `${pointer}/slots`, c);
  validateBindings(node.bindings, `${pointer}/bindings`, c);
  validateEvents(node.events, `${pointer}/events`, c);
  validateExtensionKeys(node.extensions, `${pointer}/extensions`, c);
}

function validateStyle(style: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(style)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "style 必须是对象");
    return;
  }
  const allowed: Record<string, true> = {
    visibility: true, classNames: true, width: true, minHeightPx: true,
    paddingPx: true, marginPx: true, background: true, color: true,
    border: true, shadow: true,
  };
  for (const k of Object.keys(style)) {
    if (!allowed[k]) c.add(`${pointer}/${k}`, ERROR_CODES.DOC_SCHEMA_INVALID, `多余字段: ${k}`);
  }
  if (style.visibility !== "visible" && style.visibility !== "hidden") {
    c.add(`${pointer}/visibility`, ERROR_CODES.DOC_SCHEMA_INVALID, "visibility 必须为 visible|hidden");
  }
  if (style.width !== "auto" && style.width !== "fill") {
    c.add(`${pointer}/width`, ERROR_CODES.DOC_SCHEMA_INVALID, "width 必须为 auto|fill");
  }
  if (style.minHeightPx !== null && (typeof style.minHeightPx !== "number" || !isSafeInteger(style.minHeightPx) || style.minHeightPx < 0 || style.minHeightPx > 4096)) {
    c.add(`${pointer}/minHeightPx`, ERROR_CODES.DOC_SCHEMA_INVALID, "minHeightPx 必须为 null 或 0..4096");
  }
  if (!Array.isArray(style.classNames) || style.classNames.length > 32) {
    c.add(`${pointer}/classNames`, ERROR_CODES.DOC_SCHEMA_INVALID, "classNames 必须是不超过 32 项的数组");
  } else {
    for (let i = 0; i < style.classNames.length; i++) {
      const cls = style.classNames[i];
      if (typeof cls !== "string" || !CLASS_NAME_PATTERN.test(cls)) {
        c.add(`${pointer}/classNames/${i}`, ERROR_CODES.DOC_SCHEMA_INVALID, "className 不匹配模式");
      }
    }
  }
  validateEdgeInsets(style.paddingPx, `${pointer}/paddingPx`, c);
  validateEdgeInsets(style.marginPx, `${pointer}/marginPx`, c);
  validateColorRef(style.background, `${pointer}/background`, c);
  validateColorRef(style.color, `${pointer}/color`, c);
  validateBorder(style.border, `${pointer}/border`, c);
  const shadows: Record<string, true> = { none: true, sm: true, md: true, lg: true };
  if (typeof style.shadow !== "string" || !shadows[style.shadow]) {
    c.add(`${pointer}/shadow`, ERROR_CODES.DOC_SCHEMA_INVALID, "shadow 必须为 none|sm|md|lg");
  }
}

function validateEdgeInsets(v: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(v)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "必须是对象");
    return;
  }
  for (const k of ["top", "right", "bottom", "left"]) {
    const x = v[k];
    if (typeof x !== "number" || !isSafeInteger(x) || x < 0 || x > 128) {
      c.add(`${pointer}/${k}`, ERROR_CODES.DOC_SCHEMA_INVALID, "必须是 0..128 的整数");
    }
  }
}

function validateColorRef(v: unknown, pointer: string, c: IssueCollector): void {
  if (v === null) return;
  if (!isObject(v)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "color 必须为 null 或 {kind,value}");
    return;
  }
  if (v.kind === "token") {
    const tokens: Record<string, true> = {
      background: true, surface: true, "surface-hover": true, text: true,
      "text-muted": true, border: true, accent: true, danger: true,
      success: true, warning: true,
    };
    if (typeof v.value !== "string" || !tokens[v.value]) {
      c.add(`${pointer}/value`, ERROR_CODES.DOC_SCHEMA_INVALID, "未知主题 token");
    }
  } else if (v.kind === "literal") {
    if (typeof v.value !== "string" || !isLiteralColor(v.value)) {
      c.add(`${pointer}/value`, ERROR_CODES.DOC_SCHEMA_INVALID, "literal 颜色只允许 #RRGGBB 或 #RRGGBBAA");
    }
  } else {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "kind 必须为 token|literal");
  }
}

function validateBorder(v: unknown, pointer: string, c: IssueCollector): void {
  if (v === null) return;
  if (!isObject(v)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "border 必须为 null 或对象");
    return;
  }
  if (typeof v.widthPx !== "number" || !isSafeInteger(v.widthPx) || v.widthPx < 0 || v.widthPx > 8) {
    c.add(`${pointer}/widthPx`, ERROR_CODES.DOC_SCHEMA_INVALID, "widthPx 必须为 0..8");
  }
  const styles: Record<string, true> = { solid: true, dashed: true, dotted: true };
  if (typeof v.style !== "string" || !styles[v.style]) {
    c.add(`${pointer}/style`, ERROR_CODES.DOC_SCHEMA_INVALID, "style 必须为 solid|dashed|dotted");
  }
  validateColorRef(v.color, `${pointer}/color`, c);
  if (typeof v.radiusPx !== "number" || !isSafeInteger(v.radiusPx) || v.radiusPx < 0 || v.radiusPx > 128) {
    c.add(`${pointer}/radiusPx`, ERROR_CODES.DOC_SCHEMA_INVALID, "radiusPx 必须为 0..128");
  }
}

function validateSlots(slots: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(slots)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "slots 必须是对象");
    return;
  }
  for (const slotName of Object.keys(slots)) {
    if (!SLOT_NAME_PATTERN.test(slotName)) {
      c.add(`${pointer}/${escapeSeg(slotName)}`, ERROR_CODES.DOC_SCHEMA_INVALID, "slot 名不匹配模式");
    }
    const refs = slots[slotName];
    if (!Array.isArray(refs)) {
      c.add(`${pointer}/${escapeSeg(slotName)}`, ERROR_CODES.DOC_SCHEMA_INVALID, "slot 值必须是数组");
      continue;
    }
    const seen = new Set<string>();
    for (let i = 0; i < refs.length; i++) {
      validateChildRef(refs[i], `${pointer}/${escapeSeg(slotName)}/${i}`, c);
      const ref = refs[i] as { nodeId?: unknown } | null;
      if (isObject(ref) && typeof ref.nodeId === "string") {
        if (seen.has(ref.nodeId)) {
          c.add(`${pointer}/${escapeSeg(slotName)}/${i}`, ERROR_CODES.DOC_SCHEMA_INVALID, "同一 Slot 重复引用同一 nodeId");
        }
        seen.add(ref.nodeId);
      }
    }
  }
}

function validateChildRef(ref: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(ref)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "ChildRef 必须是对象");
    return;
  }
  if (typeof ref.nodeId !== "string" || !UUID_V4_PATTERN.test(ref.nodeId)) {
    c.add(`${pointer}/nodeId`, ERROR_CODES.DOC_ID_INVALID, "nodeId 必须是 UUID v4");
  }
  validatePlacement(ref.placement, `${pointer}/placement`, c);
}

function validatePlacement(p: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(p)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "placement 必须是对象");
    return;
  }
  // tab
  const tab = p.tab as Record<string, unknown> | undefined;
  if (!isObject(tab)) {
    c.add(`${pointer}/tab`, ERROR_CODES.DOC_SCHEMA_INVALID, "tab 必须是对象");
  } else {
    if (tab.title !== null && (typeof tab.title !== "string" || Array.from(tab.title).length > 120)) {
      c.add(`${pointer}/tab/title`, ERROR_CODES.DOC_SCHEMA_INVALID, "tab.title 必须为 null 或 <=120");
    }
    if (tab.icon !== null && (typeof tab.icon !== "string" || !/^[a-z0-9-]+$/.test(tab.icon))) {
      c.add(`${pointer}/tab/icon`, ERROR_CODES.DOC_SCHEMA_INVALID, "tab.icon 必须为 null 或受控 Icon Key");
    }
    if (typeof tab.disabled !== "boolean") {
      c.add(`${pointer}/tab/disabled`, ERROR_CODES.DOC_SCHEMA_INVALID, "tab.disabled 必须是 boolean");
    }
  }
  // column
  const col = p.column as Record<string, unknown> | undefined;
  if (!isObject(col)) {
    c.add(`${pointer}/column`, ERROR_CODES.DOC_SCHEMA_INVALID, "column 必须是对象");
  } else {
    if (typeof col.basisBp !== "number" || !isSafeInteger(col.basisBp) || col.basisBp < 1 || col.basisBp > 10000) {
      c.add(`${pointer}/column/basisBp`, ERROR_CODES.DOC_SCHEMA_INVALID, "basisBp 必须为 1..10000 整数");
    }
    for (const k of ["grow", "shrink"]) {
      const x = col[k];
      if (typeof x !== "number" || !isSafeInteger(x) || x < 0 || x > 100) {
        c.add(`${pointer}/column/${k}`, ERROR_CODES.DOC_SCHEMA_INVALID, "必须为 0..100 整数");
      }
    }
    if (typeof col.minWidthPx !== "number" || !isSafeInteger(col.minWidthPx) || col.minWidthPx < 0 || col.minWidthPx > 4096) {
      c.add(`${pointer}/column/minWidthPx`, ERROR_CODES.DOC_SCHEMA_INVALID, "minWidthPx 必须为 0..4096");
    }
    if (col.maxWidthPx !== null && (typeof col.maxWidthPx !== "number" || !isSafeInteger(col.maxWidthPx) || col.maxWidthPx < 1 || col.maxWidthPx > 8192)) {
      c.add(`${pointer}/column/maxWidthPx`, ERROR_CODES.DOC_SCHEMA_INVALID, "maxWidthPx 必须为 null 或 1..8192");
    }
    if (
      typeof col.minWidthPx === "number" &&
      typeof col.maxWidthPx === "number" &&
      col.maxWidthPx < col.minWidthPx
    ) {
      c.add(`${pointer}/column/maxWidthPx`, ERROR_CODES.DOC_SCHEMA_INVALID, "maxWidthPx 不得小于 minWidthPx");
    }
  }
  // grid
  const grid = p.grid as Record<string, unknown> | undefined;
  if (!isObject(grid)) {
    c.add(`${pointer}/grid`, ERROR_CODES.DOC_SCHEMA_INVALID, "grid 必须是对象");
  } else {
    for (const bp of ["compact", "regular", "wide"]) {
      validateGridRect(grid[bp], `${pointer}/grid/${bp}`, c);
    }
  }
}

function validateGridRect(r: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(r)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "GridRect 必须是对象");
    return;
  }
  for (const k of ["x", "y", "w", "h", "minW", "minH"]) {
    const x = r[k];
    if (typeof x !== "number" || !isSafeInteger(x) || x < 0 || (k !== "x" && k !== "y" && x < 1)) {
      c.add(`${pointer}/${k}`, ERROR_CODES.DOC_SCHEMA_INVALID, "必须为非负整数（宽高 >=1）");
    }
  }
  for (const k of ["maxW", "maxH"]) {
    const x = r[k];
    if (x !== null && (typeof x !== "number" || !isSafeInteger(x) || x < 1)) {
      c.add(`${pointer}/${k}`, ERROR_CODES.DOC_SCHEMA_INVALID, "必须为 null 或 >=1 整数");
    }
  }
  const num = (k: string): number => (typeof r[k] === "number" ? (r[k] as number) : -1);
  if (num("minW") > num("w")) c.add(`${pointer}/minW`, ERROR_CODES.DOC_PLACEMENT_INVALID, "minW 不得大于 w");
  if (num("minH") > num("h")) c.add(`${pointer}/minH`, ERROR_CODES.DOC_PLACEMENT_INVALID, "minH 不得大于 h");
  if (r.maxW !== null && num("maxW") < num("w")) c.add(`${pointer}/maxW`, ERROR_CODES.DOC_PLACEMENT_INVALID, "maxW 不得小于 w");
  if (r.maxH !== null && num("maxH") < num("h")) c.add(`${pointer}/maxH`, ERROR_CODES.DOC_PLACEMENT_INVALID, "maxH 不得小于 h");
}

function validateBindings(bindings: unknown, pointer: string, c: IssueCollector): void {
  if (!Array.isArray(bindings)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "bindings 必须是数组");
    return;
  }
  if (bindings.length > DOCUMENT_LIMITS.maxBindingsPerNode) {
    c.add(pointer, ERROR_CODES.DOC_TOO_LARGE, "单节点 Binding 超过 256");
  }
  const ids = new Set<string>();
  const targets = new Set<string>();
  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i];
    if (!isObject(b)) {
      c.add(`${pointer}/${i}`, ERROR_CODES.DOC_SCHEMA_INVALID, "Binding 必须是对象");
      continue;
    }
    if (typeof b.id !== "string" || !UUID_V4_PATTERN.test(b.id)) {
      c.add(`${pointer}/${i}/id`, ERROR_CODES.DOC_ID_INVALID, "binding id 必须是 UUID v4");
    } else if (ids.has(b.id)) {
      c.add(`${pointer}/${i}/id`, ERROR_CODES.BINDING_ID_DUPLICATE, "binding id 重复");
    } else {
      ids.add(b.id);
    }
    if (typeof b.target !== "string" || b.target.length === 0 || !b.target.startsWith("/")) {
      c.add(`${pointer}/${i}/target`, ERROR_CODES.BINDING_TARGET_INVALID, "target 必须是相对 props 根的 RFC 6901 pointer");
    } else {
      if (targets.has(b.target)) {
        c.add(`${pointer}/${i}/target`, ERROR_CODES.BINDING_TARGET_DUPLICATE, "target 重复");
      }
      for (const t of targets) {
        if (isAncestorPointer(t, b.target) || isAncestorPointer(b.target, t)) {
          c.add(`${pointer}/${i}/target`, ERROR_CODES.BINDING_TARGET_OVERLAP, "target 存在祖先/后代重叠");
        }
      }
      targets.add(b.target);
    }
    validateExpr(b.expr, `${pointer}/${i}/expr`, c);
    const onErrors: Record<string, true> = {
      "use-fallback": true, "use-static": true, "hide-node": true, "show-error": true,
    };
    if (typeof b.onError !== "string" || !onErrors[b.onError]) {
      c.add(`${pointer}/${i}/onError`, ERROR_CODES.DOC_SCHEMA_INVALID, "onError 必须为 use-fallback|use-static|hide-node|show-error");
    }
  }
}

function isAncestorPointer(a: string, b: string): boolean {
  return b.startsWith(`${a}/`);
}

function validateExpr(expr: unknown, pointer: string, c: IssueCollector, depth = 0): void {
  if (depth > DOCUMENT_LIMITS.maxExprDepth) {
    c.add(pointer, ERROR_CODES.DOC_TREE_TOO_DEEP, "表达式深度超过 32");
    return;
  }
  if (!isObject(expr)) {
    c.add(pointer, ERROR_CODES.EXPR_SCHEMA_INVALID, "Expr 必须是对象");
    return;
  }
  if (typeof expr.op !== "string" || !EXPR_OPS[expr.op]) {
    c.add(`${pointer}/op`, ERROR_CODES.EXPR_SCHEMA_INVALID, "未知 op");
    return;
  }
  switch (expr.op) {
    case "literal":
      break;
    case "context":
      if (typeof expr.name !== "string" || !EXPR_CONTEXT_NAMES[expr.name]) {
        c.add(`${pointer}/name`, ERROR_CODES.EXPR_SCHEMA_INVALID, "未知 context 名");
      }
      break;
    case "source":
      if (typeof expr.sourceId !== "string" || !UUID_V4_PATTERN.test(expr.sourceId)) {
        c.add(`${pointer}/sourceId`, ERROR_CODES.EXPR_SCHEMA_INVALID, "sourceId 必须是 UUID v4");
      }
      break;
    case "get":
      if (typeof expr.pointer !== "string") {
        c.add(`${pointer}/pointer`, ERROR_CODES.EXPR_SCHEMA_INVALID, "pointer 必须是字符串");
      }
      validateExpr(expr.value, `${pointer}/value`, c, depth + 1);
      break;
    case "call": {
      if (typeof expr.fn !== "string" || !BUILTIN_FNS[expr.fn]) {
        c.add(`${pointer}/fn`, ERROR_CODES.EXPR_SCHEMA_INVALID, "未知内置函数");
      }
      if (!Array.isArray(expr.args)) {
        c.add(`${pointer}/args`, ERROR_CODES.EXPR_SCHEMA_INVALID, "args 必须是数组");
      } else {
        expr.args.forEach((a, i) => validateExpr(a, `${pointer}/args/${i}`, c, depth + 1));
      }
      break;
    }
    case "if":
      validateExpr(expr.condition, `${pointer}/condition`, c, depth + 1);
      validateExpr(expr.then, `${pointer}/then`, c, depth + 1);
      validateExpr(expr.else, `${pointer}/else`, c, depth + 1);
      break;
    case "array":
      if (!Array.isArray(expr.items)) {
        c.add(`${pointer}/items`, ERROR_CODES.EXPR_SCHEMA_INVALID, "items 必须是数组");
      } else {
        expr.items.forEach((a, i) => validateExpr(a, `${pointer}/items/${i}`, c, depth + 1));
      }
      break;
    case "object":
      if (!isObject(expr.entries)) {
        c.add(`${pointer}/entries`, ERROR_CODES.EXPR_SCHEMA_INVALID, "entries 必须是对象");
      } else {
        for (const k of Object.keys(expr.entries)) {
          validateExpr(expr.entries[k], `${pointer}/entries/${escapeSeg(k)}`, c, depth + 1);
        }
      }
      break;
  }
}

function validateEvents(events: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(events)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "events 必须是对象");
    return;
  }
  if (Object.keys(events).length > DOCUMENT_LIMITS.maxEventsPerNode) {
    c.add(pointer, ERROR_CODES.DOC_TOO_LARGE, "单节点事件种类超过 64");
  }
  for (const name of Object.keys(events)) {
    if (!SLOT_NAME_PATTERN.test(name)) {
      c.add(`${pointer}/${escapeSeg(name)}`, ERROR_CODES.DOC_SCHEMA_INVALID, "事件名不匹配模式");
    }
    validateEventSequence(events[name], `${pointer}/${escapeSeg(name)}`, c);
  }
}

function validateEventSequence(seq: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(seq)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "EventSequence 必须是对象");
    return;
  }
  const concurrencies: Record<string, true> = { drop: true, restart: true, queue: true };
  if (typeof seq.concurrency !== "string" || !concurrencies[seq.concurrency]) {
    c.add(`${pointer}/concurrency`, ERROR_CODES.DOC_SCHEMA_INVALID, "concurrency 必须为 drop|restart|queue");
  }
  if (typeof seq.maxQueue !== "number" || !isSafeInteger(seq.maxQueue) || seq.maxQueue < 0 || seq.maxQueue > 20) {
    c.add(`${pointer}/maxQueue`, ERROR_CODES.DOC_SCHEMA_INVALID, "maxQueue 必须为 0..20");
  }
  if (typeof seq.preventDefault !== "boolean") {
    c.add(`${pointer}/preventDefault`, ERROR_CODES.DOC_SCHEMA_INVALID, "preventDefault 必须是 boolean");
  }
  if (typeof seq.stopPropagation !== "boolean") {
    c.add(`${pointer}/stopPropagation`, ERROR_CODES.DOC_SCHEMA_INVALID, "stopPropagation 必须是 boolean");
  }
  if (!Array.isArray(seq.actions)) {
    c.add(`${pointer}/actions`, ERROR_CODES.DOC_SCHEMA_INVALID, "actions 必须是数组");
    return;
  }
  if (seq.actions.length > DOCUMENT_LIMITS.maxActionsPerEvent) {
    c.add(`${pointer}/actions`, ERROR_CODES.DOC_TOO_LARGE, "单事件动作超过 100");
  }
  const actionIds = new Set<string>();
  const resultKeys = new Set<string>();
  seq.actions.forEach((a, i) => {
    validateAction(a, `${pointer}/actions/${i}`, c);
    if (isObject(a)) {
      if (typeof a.id === "string") {
        if (actionIds.has(a.id)) {
          c.add(`${pointer}/actions/${i}/id`, ERROR_CODES.ACTION_ID_DUPLICATE, "Action ID 在节点内重复");
        }
        actionIds.add(a.id);
      }
      if (a.resultKey !== null && typeof a.resultKey === "string") {
        if (resultKeys.has(a.resultKey)) {
          c.add(`${pointer}/actions/${i}/resultKey`, ERROR_CODES.ACTION_RESULT_KEY_DUPLICATE, "resultKey 在序列内重复");
        }
        resultKeys.add(a.resultKey);
      }
    }
  });
}

function validateAction(a: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(a)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "Action 必须是对象");
    return;
  }
  // opaque 分支
  if ("classification" in a && "raw" in a) {
    if (typeof a.id !== "string" || !UUID_V4_PATTERN.test(a.id)) {
      c.add(`${pointer}/id`, ERROR_CODES.DOC_ID_INVALID, "action id 必须是 UUID v4");
    }
    if (typeof a.specVersion !== "number" || !isSafeInteger(a.specVersion) || a.specVersion < 1) {
      c.add(`${pointer}/specVersion`, ERROR_CODES.DOC_SCHEMA_INVALID, "specVersion 必须是 >=1 整数");
    }
    if (a.classification !== "unknown" && a.classification !== "future") {
      c.add(`${pointer}/classification`, ERROR_CODES.DOC_SCHEMA_INVALID, "classification 必须为 unknown|future");
    }
    return;
  }
  if (typeof a.type !== "string" || !KNOWN_ACTION_TYPES[a.type]) {
    c.add(`${pointer}/type`, ERROR_CODES.ACTION_TYPE_UNKNOWN, "未知 Action 类型");
    return;
  }
  const baseRequired: Record<string, true> = {
    id: true, type: true, specVersion: true, enabled: true, label: true,
    when: true, resultKey: true, timeoutMs: true, confirmation: true,
    onError: true, extensions: true,
  };
  for (const k of Object.keys(baseRequired)) {
    if (!(k in a)) c.add(`${pointer}/${k}`, ERROR_CODES.DOC_SCHEMA_INVALID, `缺少必填字段: ${k}`);
  }
  if (typeof a.specVersion !== "number" || !isSafeInteger(a.specVersion) || a.specVersion < 1) {
    c.add(`${pointer}/specVersion`, ERROR_CODES.DOC_SCHEMA_INVALID, "specVersion 必须是 >=1 整数");
  }
  if (typeof a.enabled !== "boolean") c.add(`${pointer}/enabled`, ERROR_CODES.DOC_SCHEMA_INVALID, "enabled 必须是 boolean");
  if (a.label !== null && typeof a.label !== "string") c.add(`${pointer}/label`, ERROR_CODES.DOC_SCHEMA_INVALID, "label 必须为 null 或 string");
  if (a.when !== null) validateExpr(a.when, `${pointer}/when`, c);
  if (a.resultKey !== null && (typeof a.resultKey !== "string" || !RESULT_KEY_PATTERN.test(a.resultKey))) {
    c.add(`${pointer}/resultKey`, ERROR_CODES.DOC_SCHEMA_INVALID, "resultKey 必须为 null 或匹配模式");
  }
  if (typeof a.timeoutMs !== "number" || !isSafeInteger(a.timeoutMs) || a.timeoutMs < 100 || a.timeoutMs > 60000) {
    c.add(`${pointer}/timeoutMs`, ERROR_CODES.DOC_SCHEMA_INVALID, "timeoutMs 必须为 100..60000");
  }
  if (typeof a.onError !== "string" || !ON_ERROR_VALUES[a.onError]) {
    c.add(`${pointer}/onError`, ERROR_CODES.DOC_SCHEMA_INVALID, "onError 必须为 stop|continue");
  }
  validateConfirmation(a.confirmation, `${pointer}/confirmation`, c);
  validateExtensionKeys(a.extensions, `${pointer}/extensions`, c);

  const type = a.type as string;
  switch (type) {
    case "file.open": {
      validateExpr(a.path, `${pointer}/path`, c);
      const disps: Record<string, true> = { "current-tab": true, "new-tab": true, split: true };
      if (typeof a.disposition !== "string" || !disps[a.disposition]) {
        c.add(`${pointer}/disposition`, ERROR_CODES.DOC_SCHEMA_INVALID, "disposition 必须为 current-tab|new-tab|split");
      }
      if (a.line !== null) validateExpr(a.line, `${pointer}/line`, c);
      if (a.column !== null) validateExpr(a.column, `${pointer}/column`, c);
      break;
    }
    case "url.open":
      validateExpr(a.url, `${pointer}/url`, c);
      break;
    case "command.execute":
      validateExpr(a.commandId, `${pointer}/commandId`, c);
      break;
    case "file.create": {
      validateExpr(a.path, `${pointer}/path`, c);
      validateExpr(a.content, `${pointer}/content`, c);
      if (typeof a.createParents !== "boolean") c.add(`${pointer}/createParents`, ERROR_CODES.DOC_SCHEMA_INVALID, "createParents 必须是 boolean");
      const ifs: Record<string, true> = { error: true, "open-existing": true, "append-number": true };
      if (typeof a.ifExists !== "string" || !ifs[a.ifExists]) {
        c.add(`${pointer}/ifExists`, ERROR_CODES.DOC_SCHEMA_INVALID, "ifExists 必须为 error|open-existing|append-number");
      }
      if (typeof a.openAfterCreate !== "boolean") c.add(`${pointer}/openAfterCreate`, ERROR_CODES.DOC_SCHEMA_INVALID, "openAfterCreate 必须是 boolean");
      break;
    }
    case "frontmatter.update": {
      validateExpr(a.path, `${pointer}/path`, c);
      if (!Array.isArray(a.patches)) {
        c.add(`${pointer}/patches`, ERROR_CODES.DOC_SCHEMA_INVALID, "patches 必须是数组");
      } else {
        a.patches.forEach((p: unknown, i: number) => {
          if (!isObject(p)) {
            c.add(`${pointer}/patches/${i}`, ERROR_CODES.DOC_SCHEMA_INVALID, "patch 必须是对象");
            return;
          }
          if (p.op === "set" || p.op === "append") {
            validateExpr(p.key, `${pointer}/patches/${i}/key`, c);
            validateExpr(p.value, `${pointer}/patches/${i}/value`, c);
            if (p.op === "append" && typeof p.unique !== "boolean") {
              c.add(`${pointer}/patches/${i}/unique`, ERROR_CODES.DOC_SCHEMA_INVALID, "unique 必须是 boolean");
            }
          } else if (p.op === "delete") {
            validateExpr(p.key, `${pointer}/patches/${i}/key`, c);
          } else {
            c.add(`${pointer}/patches/${i}/op`, ERROR_CODES.DOC_SCHEMA_INVALID, "op 必须为 set|delete|append");
          }
        });
      }
      break;
    }
    case "markdown.task.update": {
      const loc = a.locator as Record<string, unknown> | undefined;
      if (!isObject(loc)) {
        c.add(`${pointer}/locator`, ERROR_CODES.DOC_SCHEMA_INVALID, "locator 必须是对象");
      } else {
        validateExpr(loc.path, `${pointer}/locator/path`, c);
        validateExpr(loc.expectedRawHash, `${pointer}/locator/expectedRawHash`, c);
        validateExpr(loc.line, `${pointer}/locator/line`, c);
        validateExpr(loc.expectedLineText, `${pointer}/locator/expectedLineText`, c);
        validateExpr(loc.expectedStatus, `${pointer}/locator/expectedStatus`, c);
        if (loc.blockId !== null) validateExpr(loc.blockId, `${pointer}/locator/blockId`, c);
      }
      validateExpr(a.nextStatus, `${pointer}/nextStatus`, c);
      break;
    }
    case "clipboard.copy":
      validateExpr(a.text, `${pointer}/text`, c);
      if (a.successMessage !== null) validateExpr(a.successMessage, `${pointer}/successMessage`, c);
      break;
    case "notice.show": {
      validateExpr(a.message, `${pointer}/message`, c);
      const levels: Record<string, true> = { info: true, success: true, warning: true, error: true };
      if (typeof a.level !== "string" || !levels[a.level]) {
        c.add(`${pointer}/level`, ERROR_CODES.DOC_SCHEMA_INVALID, "level 必须为 info|success|warning|error");
      }
      if (typeof a.durationMs !== "number" || !isSafeInteger(a.durationMs) || a.durationMs < 1000 || a.durationMs > 10000) {
        c.add(`${pointer}/durationMs`, ERROR_CODES.DOC_SCHEMA_INVALID, "durationMs 必须为 1000..10000");
      }
      break;
    }
  }
}

function validateConfirmation(conf: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(conf)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "confirmation 必须是对象");
    return;
  }
  if (typeof conf.mode !== "string" || !CONFIRMATION_MODES[conf.mode]) {
    c.add(`${pointer}/mode`, ERROR_CODES.DOC_SCHEMA_INVALID, "mode 必须为 never|if-untrusted|always");
  }
  for (const k of ["title", "message", "confirmLabel", "cancelLabel"]) {
    if (conf[k] !== null && typeof conf[k] !== "string") {
      c.add(`${pointer}/${k}`, ERROR_CODES.DOC_SCHEMA_INVALID, "必须为 null 或 string");
    }
  }
  if (typeof conf.danger !== "boolean") {
    c.add(`${pointer}/danger`, ERROR_CODES.DOC_SCHEMA_INVALID, "danger 必须是 boolean");
  }
  if (conf.mode === "never") {
    for (const k of ["title", "message", "confirmLabel", "cancelLabel"]) {
      if (conf[k] !== null) c.add(`${pointer}/${k}`, ERROR_CODES.DOC_SCHEMA_INVALID, "mode=never 时文案必须为 null");
    }
    if (conf.danger !== false) c.add(`${pointer}/danger`, ERROR_CODES.DOC_SCHEMA_INVALID, "mode=never 时 danger 必须为 false");
  }
}

function validateDataSource(ds: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(ds)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "DataSource 必须是对象");
    return;
  }
  if ("classification" in ds && "raw" in ds) {
    // OpaqueDataSourceSpecV1
    if (typeof ds.id !== "string" || !UUID_V4_PATTERN.test(ds.id)) {
      c.add(`${pointer}/id`, ERROR_CODES.DOC_ID_INVALID, "id 必须是 UUID v4");
    }
    if (typeof ds.specVersion !== "number" || !isSafeInteger(ds.specVersion) || ds.specVersion < 1) {
      c.add(`${pointer}/specVersion`, ERROR_CODES.DOC_SCHEMA_INVALID, "specVersion 必须是 >=1 整数");
    }
    if (ds.classification !== "unknown" && ds.classification !== "future") {
      c.add(`${pointer}/classification`, ERROR_CODES.DOC_SCHEMA_INVALID, "classification 必须为 unknown|future");
    }
    return;
  }
  if (typeof ds.id !== "string" || !UUID_V4_PATTERN.test(ds.id)) {
    c.add(`${pointer}/id`, ERROR_CODES.DOC_ID_INVALID, "id 必须是 UUID v4");
  }
  if (ds.type !== "vault.query") {
    c.add(`${pointer}/type`, ERROR_CODES.DATA_SOURCE_TYPE_UNKNOWN, "V1 只允许 vault.query");
  }
  if (typeof ds.specVersion !== "number" || !isSafeInteger(ds.specVersion) || ds.specVersion < 1) {
    c.add(`${pointer}/specVersion`, ERROR_CODES.DOC_SCHEMA_INVALID, "specVersion 必须是 >=1 整数");
  }
  if (typeof ds.enabled !== "boolean") c.add(`${pointer}/enabled`, ERROR_CODES.DOC_SCHEMA_INVALID, "enabled 必须是 boolean");
  if (ds.label !== null && typeof ds.label !== "string") c.add(`${pointer}/label`, ERROR_CODES.DOC_SCHEMA_INVALID, "label 必须为 null 或 string");
  if (!isPlainObject(ds.config)) c.add(`${pointer}/config`, ERROR_CODES.DOC_SCHEMA_INVALID, "config 必须是 JSON 对象");
  const ref = ds.refresh as Record<string, unknown> | undefined;
  if (!isObject(ref)) {
    c.add(`${pointer}/refresh`, ERROR_CODES.DOC_SCHEMA_INVALID, "refresh 必须是对象");
  } else {
    if (typeof ref.mode !== "string" || !REFRESH_MODES[ref.mode]) {
      c.add(`${pointer}/refresh/mode`, ERROR_CODES.DOC_SCHEMA_INVALID, "mode 必须为 on-vault-change|manual|interval");
    }
    if (ref.mode === "interval") {
      if (typeof ref.intervalMs !== "number" || !isSafeInteger(ref.intervalMs) || ref.intervalMs < 1000 || ref.intervalMs > 86400000) {
        c.add(`${pointer}/refresh/intervalMs`, ERROR_CODES.DATASOURCE_INTERVAL_INVALID, "intervalMs 必须为 1000..86400000");
      }
    }
  }
  validateExtensionKeys(ds.extensions, `${pointer}/extensions`, c);
}

function validatePermissions(p: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(p)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "permissions 必须是对象");
    return;
  }
  if (!Array.isArray(p.requested)) {
    c.add(`${pointer}/requested`, ERROR_CODES.DOC_SCHEMA_INVALID, "requested 必须是数组");
    return;
  }
  const seen = new Set<string>();
  const knownCapabilities: Record<string, true> = {
    "vault:read": true, "vault:create": true, "vault:modify": true,
    "workspace:navigate": true, "command:execute": true, "clipboard:write": true,
    "external-url:open": true, "query:read": true, "timer:use": true,
    "network:request": true,
  };
  p.requested.forEach((r, i) => {
    if (!isObject(r)) {
      c.add(`${pointer}/requested/${i}`, ERROR_CODES.DOC_SCHEMA_INVALID, "请求必须是对象");
      return;
    }
    if (typeof r.capability !== "string" || !knownCapabilities[r.capability]) {
      c.add(`${pointer}/requested/${i}/capability`, ERROR_CODES.DOC_SCHEMA_INVALID, "未知能力");
    } else if (seen.has(r.capability)) {
      c.add(`${pointer}/requested/${i}/capability`, ERROR_CODES.DOC_SCHEMA_INVALID, "同一种 Capability 只出现一次");
    } else {
      seen.add(r.capability);
    }
    if (typeof r.reason !== "string" || r.reason.length < 1 || Array.from(r.reason).length > 300) {
      c.add(`${pointer}/requested/${i}/reason`, ERROR_CODES.DOC_SCHEMA_INVALID, "reason 必须为 1..300 code points");
    }
  });
}

function validateMetadata(m: unknown, pointer: string, c: IssueCollector): void {
  if (!isObject(m)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "metadata 必须是对象");
    return;
  }
  if (typeof m.title !== "string" || Array.from(m.title).length > 120) {
    c.add(`${pointer}/title`, ERROR_CODES.DOC_SCHEMA_INVALID, "title 必须为 0..120 code points");
  }
  if (typeof m.description !== "string" || Array.from(m.description).length > 2000) {
    c.add(`${pointer}/description`, ERROR_CODES.DOC_SCHEMA_INVALID, "description 必须为 0..2000 code points");
  }
  if (!Array.isArray(m.tags) || m.tags.length > 32) {
    c.add(`${pointer}/tags`, ERROR_CODES.DOC_SCHEMA_INVALID, "tags 必须是不超过 32 项的数组");
    return;
  }
  const seen = new Set<string>();
  m.tags.forEach((t, i) => {
    if (typeof t !== "string" || t.length < 1 || Array.from(t).length > 64 || t.startsWith("#")) {
      c.add(`${pointer}/tags/${i}`, ERROR_CODES.DOC_SCHEMA_INVALID, "tag 必须为 1..64 code points 且不以 # 开头");
    } else if (seen.has(t)) {
      c.add(`${pointer}/tags/${i}`, ERROR_CODES.DOC_SCHEMA_INVALID, "tag 重复（区分大小写）");
    } else {
      seen.add(t);
    }
  });
}

function validateExtensionKeys(ext: unknown, pointer: string, c: IssueCollector): void {
  if (ext === undefined || ext === null) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "extensions 缺失");
    return;
  }
  if (!isObject(ext)) {
    c.add(pointer, ERROR_CODES.DOC_SCHEMA_INVALID, "extensions 必须是对象");
    return;
  }
  for (const k of Object.keys(ext)) {
    if (!TYPE_NAMESPACE_PATTERN.test(k)) {
      c.add(`${pointer}/${escapeSeg(k)}`, ERROR_CODES.DOC_SCHEMA_INVALID, "扩展键必须匹配命名空间模式");
    }
    if (k.startsWith("core.") || k.startsWith("system.") || k.startsWith("components-studio.")) {
      c.add(`${pointer}/${escapeSeg(k)}`, ERROR_CODES.DOC_SCHEMA_INVALID, "保留命名空间不得由第三方写入");
    }
  }
}

function roughJsonSize(value: JsonValue): number {
  // 保守估算：JSON.stringify 输出字节。
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function escapeSeg(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
