/**
 * 规范化序列化（《文档与会话协议 v1》第 6.4 节）。
 *
 * 1. 顶层键按 Schema 声明顺序。
 * 2. ComponentNode、DataSource、Binding、Action、Style 等已知结构按其 Schema 声明顺序。
 * 3. `nodes` 和 `dataSources` 的键按 Unicode code point 字典序。
 * 4. 未知普通 Object 键按 Unicode code point 字典序。
 * 5. Slot、Binding、Event Action、Tag 等 Array 保持语义顺序。
 * 6. 两空格缩进；无尾随空格；LF；末尾一个 LF；`-0` 输出为 `0`；不做 Unicode 正规化。
 */

import type {
  ComponentsDocumentV1,
  DeepReadonly,
  JsonValue,
} from "@ocs/contracts";

type Json = JsonValue;

/** 值结构种类：决定当前对象的键顺序与子值种类。 */
type Kind =
  | "scalar"
  | "unknown"
  | "root"
  | "node-map"
  | "node"
  | "style"
  | "edge"
  | "colorref"
  | "border"
  | "slot-map"
  | "childref-array"
  | "childref"
  | "placement"
  | "tab"
  | "column"
  | "grid"
  | "gridrect"
  | "binding-array"
  | "binding"
  | "expr"
  | "event-map"
  | "eventseq"
  | "action-array"
  | "action"
  | "opaque-action"
  | "confirmation"
  | "patch-array"
  | "patch"
  | "locator"
  | "datasource-map"
  | "datasource"
  | "opaque-datasource"
  | "refresh"
  | "permissions"
  | "request-array"
  | "capability-request"
  | "metadata";

const KEY_ORDER: Record<string, readonly string[]> = {
  root: [
    "kind", "formatVersion", "documentId", "revision", "createdAt",
    "updatedAt", "rootId", "nodes", "dataSources", "permissions",
    "metadata", "extensions",
  ],
  node: [
    "id", "type", "specVersion", "enabled", "label", "props", "style",
    "slots", "bindings", "events", "extensions",
  ],
  style: [
    "visibility", "classNames", "width", "minHeightPx", "paddingPx",
    "marginPx", "background", "color", "border", "shadow",
  ],
  edge: ["top", "right", "bottom", "left"],
  colorref: ["kind", "value"],
  border: ["widthPx", "style", "color", "radiusPx"],
  childref: ["nodeId", "placement"],
  placement: ["tab", "column", "grid", "extensions"],
  tab: ["title", "icon", "disabled"],
  column: ["basisBp", "grow", "shrink", "minWidthPx", "maxWidthPx"],
  grid: ["compact", "regular", "wide"],
  gridrect: ["x", "y", "w", "h", "minW", "maxW", "minH", "maxH"],
  binding: ["id", "target", "expr", "pendingValue", "fallbackValue", "onError"],
  eventseq: ["concurrency", "maxQueue", "preventDefault", "stopPropagation", "actions"],
  confirmation: ["mode", "title", "message", "confirmLabel", "cancelLabel", "danger"],
  locator: ["path", "expectedRawHash", "line", "expectedLineText", "expectedStatus", "blockId"],
  datasource: ["id", "type", "specVersion", "enabled", "label", "config", "refresh", "extensions"],
  "opaque-datasource": ["id", "type", "specVersion", "raw", "classification"],
  "opaque-action": ["id", "type", "specVersion", "raw", "classification"],
  permissions: ["requested"],
  "capability-request": ["capability", "reason"],
  metadata: ["title", "description", "tags"],
};

const ACTION_BASE: readonly string[] = [
  "id", "type", "specVersion", "enabled", "label", "when", "resultKey",
  "timeoutMs", "confirmation", "onError", "extensions",
];

const ACTION_EXTRA: Record<string, readonly string[]> = {
  "file.open": ["path", "disposition", "line", "column"],
  "url.open": ["url"],
  "command.execute": ["commandId"],
  "file.create": ["path", "content", "createParents", "ifExists", "openAfterCreate"],
  "frontmatter.update": ["path", "patches"],
  "markdown.task.update": ["locator", "nextStatus"],
  "clipboard.copy": ["text", "successMessage"],
  "notice.show": ["message", "level", "durationMs"],
};

const EXPR_ORDER: Record<string, readonly string[]> = {
  literal: ["op", "value"],
  context: ["op", "name"],
  source: ["op", "sourceId"],
  get: ["op", "value", "pointer"],
  call: ["op", "fn", "args"],
  if: ["op", "condition", "then", "else"],
  array: ["op", "items"],
  object: ["op", "entries"],
};

const PATCH_ORDER: Record<string, readonly string[]> = {
  set: ["op", "key", "value"],
  delete: ["op", "key"],
  append: ["op", "key", "value", "unique"],
};

const REFRESH_ORDER: Record<string, readonly string[]> = {
  "on-vault-change": ["mode"],
  manual: ["mode"],
  interval: ["mode", "intervalMs"],
};

function sortedKeys(obj: Record<string, Json>): string[] {
  return Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

class CanonicalWriter {
  private out = "";
  private depth = 0;

  toString(): string {
    return this.out;
  }

  write(value: Json, kind: Kind): void {
    if (value === null) {
      this.out += "null";
      return;
    }
    switch (typeof value) {
      case "boolean":
        this.out += value ? "true" : "false";
        return;
      case "number": {
        this.out += Object.is(value, -0) ? "0" : String(value);
        return;
      }
      case "string":
        this.writeString(value);
        return;
      case "object": {
        if (Array.isArray(value)) {
          this.writeArray(value, kind);
        } else {
          this.writeObject(value as Record<string, Json>, kind);
        }
        return;
      }
      default:
        throw new Error(`无法序列化的值: ${typeof value}`);
    }
  }

  private childKind(kind: Kind, key: string): Kind {
    switch (kind) {
      case "root":
        if (key === "nodes") return "node-map";
        if (key === "dataSources") return "datasource-map";
        if (key === "permissions") return "permissions";
        if (key === "metadata") return "metadata";
        return "unknown";
      case "node":
        if (key === "style") return "style";
        if (key === "slots") return "slot-map";
        if (key === "bindings") return "binding-array";
        if (key === "events") return "event-map";
        if (key === "props" || key === "extensions") return "unknown";
        return "scalar";
      case "style":
        if (key === "paddingPx" || key === "marginPx") return "edge";
        if (key === "background" || key === "color") return "colorref";
        if (key === "border") return "border";
        return "scalar";
      case "edge":
        return "scalar";
      case "colorref":
        return "scalar";
      case "border":
        if (key === "color") return "colorref";
        return "scalar";
      case "childref":
        if (key === "placement") return "placement";
        return "scalar";
      case "placement":
        if (key === "tab") return "tab";
        if (key === "column") return "column";
        if (key === "grid") return "grid";
        return "unknown";
      case "tab":
        return "scalar";
      case "column":
        return "scalar";
      case "grid":
        if (key === "compact" || key === "regular" || key === "wide") return "gridrect";
        return "scalar";
      case "gridrect":
        return "scalar";
      case "binding":
        if (key === "expr") return "expr";
        return "unknown";
      case "expr": {
        // expr 对象键按当前 op 顺序；子值一律 unknown/scalar
        return "unknown";
      }
      case "eventseq":
        if (key === "actions") return "action-array";
        return "scalar";
      case "action":
        if (key === "confirmation") return "confirmation";
        if (key === "patches") return "patch-array";
        if (key === "locator") return "locator";
        return "unknown";
      case "opaque-action":
        return "unknown";
      case "confirmation":
        return "scalar";
      case "patch":
        return "unknown";
      case "locator":
        return "unknown";
      case "datasource":
        if (key === "refresh") return "refresh";
        return "unknown";
      case "opaque-datasource":
        return "unknown";
      case "node-map":
        return "node";
      case "slot-map":
        return "childref-array";
      case "event-map":
        return "eventseq";
      case "datasource-map":
        return "datasource";
      case "refresh":
        return "scalar";
      case "permissions":
        if (key === "requested") return "request-array";
        return "scalar";
      case "capability-request":
        return "scalar";
      case "metadata":
        return "scalar";
      default:
        return "unknown";
    }
  }

  private writeObject(obj: Record<string, Json>, kind: Kind): void {
    let keys: readonly string[];
    switch (kind) {
      case "root":
        keys = KEY_ORDER.root!;
        break;
      case "node":
        keys = KEY_ORDER.node!;
        break;
      case "style":
        keys = KEY_ORDER.style!;
        break;
      case "edge":
        keys = KEY_ORDER.edge!;
        break;
      case "colorref":
        keys = KEY_ORDER.colorref!;
        break;
      case "border":
        keys = KEY_ORDER.border!;
        break;
      case "childref":
        keys = KEY_ORDER.childref!;
        break;
      case "placement":
        keys = KEY_ORDER.placement!;
        break;
      case "tab":
        keys = KEY_ORDER.tab!;
        break;
      case "column":
        keys = KEY_ORDER.column!;
        break;
      case "grid":
        keys = KEY_ORDER.grid!;
        break;
      case "gridrect":
        keys = KEY_ORDER.gridrect!;
        break;
      case "binding":
        keys = KEY_ORDER.binding!;
        break;
      case "expr": {
        const op = typeof obj.op === "string" ? obj.op : "";
        keys = EXPR_ORDER[op] ?? sortedKeys(obj);
        break;
      }
      case "eventseq":
        keys = KEY_ORDER.eventseq!;
        break;
      case "action": {
        const type = typeof obj.type === "string" ? obj.type : "";
        const extra = ACTION_EXTRA[type];
        keys = extra ? [...ACTION_BASE, ...extra] : [...ACTION_BASE, ...sortedKeys(obj)];
        break;
      }
      case "opaque-action":
        keys = KEY_ORDER["opaque-action"]!;
        break;
      case "confirmation":
        keys = KEY_ORDER.confirmation!;
        break;
      case "patch": {
        const op = typeof obj.op === "string" ? obj.op : "";
        keys = PATCH_ORDER[op] ?? sortedKeys(obj);
        break;
      }
      case "locator":
        keys = KEY_ORDER.locator!;
        break;
      case "datasource":
        keys = KEY_ORDER.datasource!;
        break;
      case "opaque-datasource":
        keys = KEY_ORDER["opaque-datasource"]!;
        break;
      case "refresh": {
        const mode = typeof obj.mode === "string" ? obj.mode : "";
        keys = REFRESH_ORDER[mode] ?? sortedKeys(obj);
        break;
      }
      case "permissions":
        keys = KEY_ORDER.permissions!;
        break;
      case "capability-request":
        keys = KEY_ORDER["capability-request"]!;
        break;
      case "metadata":
        keys = KEY_ORDER.metadata!;
        break;
      case "unknown":
      default:
        keys = sortedKeys(obj);
        break;
    }

    const indent = "  ".repeat(this.depth);
    this.out += "{";
    if (keys.length > 0) this.out += "\n";
    let emitted = 0;
    for (const k of keys) {
      if (!(k in obj)) continue;
      this.out += `${indent}  `;
      this.writeString(k);
      this.out += ": ";
      this.depth++;
      this.write(obj[k]!, this.childKindForValue(kind, k, obj[k]!));
      this.depth--;
      emitted++;
      if (emitted < keys.length) this.out += ",";
      this.out += "\n";
    }
    if (emitted > 0) this.out += indent;
    this.out += "}";
  }

  private childKindForValue(kind: Kind, key: string, value: Json): Kind {
    const base = this.childKind(kind, key);
    if (base === "datasource") {
      // OpaqueDataSourceSpecV1 判别
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "classification" in value &&
        "raw" in value
      ) {
        return "opaque-datasource";
      }
      return "datasource";
    }
    return base;
  }

  private writeArray(arr: Json[], kind: Kind): void {
    const indent = "  ".repeat(this.depth);
    this.out += "[";
    if (arr.length > 0) this.out += "\n";
    for (let i = 0; i < arr.length; i++) {
      const element = arr[i]!;
      this.out += `${indent}  `;
      this.depth++;
      this.write(element, this.arrayElementKind(kind, element));
      this.depth--;
      if (i < arr.length - 1) this.out += ",";
      this.out += "\n";
    }
    if (arr.length > 0) this.out += indent;
    this.out += "]";
  }

  private arrayElementKind(kind: Kind, element: Json): Kind {
    switch (kind) {
      case "childref-array":
        return "childref";
      case "binding-array":
        return "binding";
      case "action-array": {
        // OpaqueActionSpecV1 判别
        if (
          element !== null &&
          typeof element === "object" &&
          !Array.isArray(element) &&
          "classification" in element &&
          "raw" in element
        ) {
          return "opaque-action";
        }
        return "action";
      }
      case "patch-array":
        return "patch";
      case "request-array":
        return "capability-request";
      default:
        return "unknown";
    }
  }

  private writeString(s: string): void {
    this.out += '"';
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!;
      switch (c) {
        case '"': this.out += '\\"'; break;
        case "\\": this.out += "\\\\"; break;
        case "\b": this.out += "\\b"; break;
        case "\f": this.out += "\\f"; break;
        case "\n": this.out += "\\n"; break;
        case "\r": this.out += "\\r"; break;
        case "\t": this.out += "\\t"; break;
        default: {
          const code = c.charCodeAt(0);
          if (code < 0x20) {
            this.out += `\\u${code.toString(16).padStart(4, "0")}`;
          } else {
            this.out += c;
          }
        }
      }
    }
    this.out += '"';
  }
}

/**
 * 规范化序列化整个文档。返回以单个 LF 结尾的规范文本。
 */
export function canonicalSerializeDocument(
  document: DeepReadonly<ComponentsDocumentV1>,
): string {
  const writer = new CanonicalWriter();
  writer.write(document as unknown as Json, "root");
  return `${writer.toString()}\n`;
}

/**
 * Content Projection：去掉顶层 `revision` 和 `updatedAt` 后的对象
 * （文档协议第 6.5 节）。其他字段包括 createdAt 全部参与。
 */
export function contentProjection(
  document: DeepReadonly<ComponentsDocumentV1>,
): Json {
  const src = document as unknown as Record<string, Json>;
  const copy: Record<string, Json> = {};
  for (const key of KEY_ORDER.root!) {
    if (key === "revision" || key === "updatedAt") continue;
    if (key in src) copy[key] = src[key]!;
  }
  return copy;
}

export function contentProjectionText(
  document: DeepReadonly<ComponentsDocumentV1>,
): string {
  const writer = new CanonicalWriter();
  writer.write(contentProjection(document), "root");
  return `${writer.toString()}\n`;
}
