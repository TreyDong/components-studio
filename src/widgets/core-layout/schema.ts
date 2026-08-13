/**
 * core.layout Props / Schema / 默认值 / validate / Slot（《运行时与 SDK 协议 v1》第 9.1 节）。
 *
 * Schema 与协议第 9.1 节一致。受控子集不含 `const`，`allowOverlap` 使用
 * 纯 boolean Schema；`validateCoreLayoutProps` 额外显式落实“必须为 false”。
 */

import { ERROR_CODES } from "@ocs/contracts";
import type { ResponsiveMode } from "@ocs/contracts";
import type { ValidationIssue, ValidationResult } from "@ocs/contracts";
import type { ComponentType } from "@ocs/contracts";
import type {
  ChildPlacement,
  ComponentNode,
  SlotDefinition,
} from "../../registry/definition";
import { validateAgainstSchema } from "../../schema/validator";
import type { JsonObjectSchema } from "../../schema/validator";

export interface CoreLayoutProps {
  readonly mode: "stack" | "columns" | "grid" | "tabs" | "vertical-tabs";
  readonly gap: number;
  readonly padding: number;
  readonly locked: boolean;
  readonly grid: {
    readonly columns: {
      readonly compact: number;
      readonly regular: number;
      readonly wide: number;
    };
    readonly rowHeight: number;
    readonly dense: boolean;
    readonly allowOverlap: false;
  };
  readonly columns: {
    readonly wrap: boolean;
    readonly equalWidth: boolean;
  };
  readonly tabs: {
    readonly activation: "automatic" | "manual";
    readonly placement: "top" | "left";
  };
}

/** 第 9.1 节冻结 Schema（const→enum 替换见文件头注释）。 */
export const coreLayoutPropsSchema: JsonObjectSchema = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: ["stack", "columns", "grid", "tabs", "vertical-tabs"],
    },
    gap: { type: "integer", minimum: 0, maximum: 48 },
    padding: { type: "integer", minimum: 0, maximum: 64 },
    locked: { type: "boolean" },
    grid: {
      type: "object",
      properties: {
        columns: {
          type: "object",
          properties: {
            compact: { type: "integer", minimum: 1, maximum: 4 },
            regular: { type: "integer", minimum: 1, maximum: 12 },
            wide: { type: "integer", minimum: 1, maximum: 24 },
          },
          required: ["compact", "regular", "wide"],
          additionalProperties: false,
        },
        rowHeight: { type: "integer", minimum: 24, maximum: 240 },
        dense: { type: "boolean" },
        allowOverlap: { type: "boolean" },
      },
      required: ["columns", "rowHeight", "dense", "allowOverlap"],
      additionalProperties: false,
    },
    columns: {
      type: "object",
      properties: {
        wrap: { type: "boolean" },
        equalWidth: { type: "boolean" },
      },
      required: ["wrap", "equalWidth"],
      additionalProperties: false,
    },
    tabs: {
      type: "object",
      properties: {
        activation: { type: "string", enum: ["automatic", "manual"] },
        placement: { type: "string", enum: ["top", "left"] },
      },
      required: ["activation", "placement"],
      additionalProperties: false,
    },
  },
  required: ["mode", "gap", "padding", "locked", "grid", "columns", "tabs"],
  additionalProperties: false,
};

/** 第 9.1 节默认 Props（每次返回全新对象）。 */
export function coreLayoutDefaultProps(): CoreLayoutProps {
  return {
    mode: "stack",
    gap: 12,
    padding: 0,
    locked: false,
    grid: {
      columns: { compact: 1, regular: 6, wide: 12 },
      rowHeight: 80,
      dense: false,
      allowOverlap: false,
    },
    columns: { wrap: true, equalWidth: false },
    tabs: { activation: "automatic", placement: "top" },
  };
}

export function validateCoreLayoutProps(input: unknown): ValidationResult<CoreLayoutProps> {
  const issues: ValidationIssue[] = [];
  validateAgainstSchema(input, coreLayoutPropsSchema, {}, issues, "$");
  // validator 的 boolean 分支不检查 enum，const:false 语义在此显式落实。
  if (input !== null && typeof input === "object" && !Array.isArray(input) && "grid" in input) {
    const grid = input.grid;
    if (
      grid !== null &&
      typeof grid === "object" &&
      !Array.isArray(grid) &&
      "allowOverlap" in grid &&
      grid.allowOverlap !== false
    ) {
      issues.push({
        pointer: "/grid/allowOverlap",
        code: ERROR_CODES.COMPONENT_PROPS_INVALID,
        message: "allowOverlap 必须为 false",
        severity: "error",
      });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  // Schema（additionalProperties:false 的对象）校验通过后即为 CoreLayoutProps。
  return { ok: true, value: input as CoreLayoutProps, warnings: [] };
}

/** 第 9.1 节默认 Placement（每次返回全新对象）。 */
export function defaultChildPlacement(): ChildPlacement {
  return {
    tab: { title: null, icon: null, disabled: false },
    column: {
      basisBp: 10000,
      grow: 0,
      shrink: 1,
      minWidthPx: 0,
      maxWidthPx: null,
    },
    grid: {
      compact: { x: 0, y: 0, w: 1, h: 4, minW: 1, maxW: null, minH: 1, maxH: null },
      regular: { x: 0, y: 0, w: 3, h: 4, minW: 1, maxW: null, minH: 1, maxH: null },
      wide: { x: 0, y: 0, w: 4, h: 4, minW: 1, maxW: null, minH: 1, maxH: null },
    },
    extensions: {},
  };
}

/**
 * Placement 校验（第 9.1 节）：字段必填且形状合法；GridRect 不得越出
 * context.columnCount（0 表示 Grid 未激活，跳过越界检查）。
 * Columns basisBp 总和由文档不变量按整组校验，此处只查单值。
 */
export function validateChildPlacement(
  placement: ChildPlacement,
  context: { readonly responsiveMode: ResponsiveMode; readonly columnCount: number },
): ValidationResult<ChildPlacement> {
  const issues: ValidationIssue[] = [];
  const err = (pointer: string, message: string): void => {
    issues.push({ pointer, code: ERROR_CODES.DOC_PLACEMENT_INVALID, message, severity: "error" });
  };

  const tab = placement.tab;
  if (typeof tab.title !== "string" && tab.title !== null) err("/tab/title", "title 必须为 string|null");
  if (typeof tab.icon !== "string" && tab.icon !== null) err("/tab/icon", "icon 必须为 string|null");
  if (typeof tab.disabled !== "boolean") err("/tab/disabled", "disabled 必须为 boolean");

  const col = placement.column;
  if (!Number.isSafeInteger(col.basisBp) || col.basisBp <= 0) err("/column/basisBp", "basisBp 必须为正整数");
  if (typeof col.grow !== "number" || col.grow < 0) err("/column/grow", "grow 必须 >= 0");
  if (typeof col.shrink !== "number" || col.shrink < 0) err("/column/shrink", "shrink 必须 >= 0");
  if (typeof col.minWidthPx !== "number" || col.minWidthPx < 0) err("/column/minWidthPx", "minWidthPx 必须 >= 0");
  if (col.maxWidthPx !== null && (typeof col.maxWidthPx !== "number" || col.maxWidthPx < col.minWidthPx)) {
    err("/column/maxWidthPx", "maxWidthPx 必须 >= minWidthPx 或为 null");
  }

  const rect = placement.grid[context.responsiveMode];
  if (!Number.isSafeInteger(rect.x) || rect.x < 0) err(`/grid/${context.responsiveMode}/x`, "x 必须为 >=0 整数");
  if (!Number.isSafeInteger(rect.y) || rect.y < 0) err(`/grid/${context.responsiveMode}/y`, "y 必须为 >=0 整数");
  if (!Number.isSafeInteger(rect.w) || rect.w < 1) err(`/grid/${context.responsiveMode}/w`, "w 必须为 >=1 整数");
  if (!Number.isSafeInteger(rect.h) || rect.h < 1) err(`/grid/${context.responsiveMode}/h`, "h 必须为 >=1 整数");
  if (!Number.isSafeInteger(rect.minW) || rect.minW < 1) err(`/grid/${context.responsiveMode}/minW`, "minW 必须为 >=1 整数");
  if (!Number.isSafeInteger(rect.minH) || rect.minH < 1) err(`/grid/${context.responsiveMode}/minH`, "minH 必须为 >=1 整数");
  if (rect.maxW !== null && (typeof rect.maxW !== "number" || rect.maxW < rect.w)) {
    err(`/grid/${context.responsiveMode}/maxW`, "maxW 必须 >= w 或为 null");
  }
  if (rect.maxH !== null && (typeof rect.maxH !== "number" || rect.maxH < rect.h)) {
    err(`/grid/${context.responsiveMode}/maxH`, "maxH 必须 >= h 或为 null");
  }
  if (context.columnCount > 0 && (rect.w > context.columnCount || rect.x + rect.w > context.columnCount)) {
    issues.push({
      pointer: `/grid/${context.responsiveMode}`,
      code: ERROR_CODES.EDITOR_PLACEMENT_OUT_OF_BOUNDS,
      message: `Grid 越出 ${context.columnCount} 列`,
      severity: "error",
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: placement, warnings: [] };
}

/** 唯一 Slot：children（many(min=0)），接受所有用户可创建组件（排除系统类型）。 */
export const coreLayoutSlots: readonly SlotDefinition<CoreLayoutProps>[] = [
  {
    name: "children",
    displayName: "子组件",
    description: "布局容器内的子组件",
    cardinality: { kind: "many", min: 0 },
    accepts: { requireUserCreatable: true, excludeCategories: [] },
    deletionPolicy: "delete-subtree",
    createDefaultPlacement: (
      _input: {
        readonly parent: ComponentNode<CoreLayoutProps>;
        readonly childType: ComponentType;
        readonly index: number;
      },
    ) => defaultChildPlacement(),
    validatePlacement: (
      placement: ChildPlacement,
      ctx: { readonly responsiveMode: ResponsiveMode; readonly columnCount: number },
    ) => validateChildPlacement(placement, ctx),
    emptyState: { label: "拖入组件" },
  },
];
