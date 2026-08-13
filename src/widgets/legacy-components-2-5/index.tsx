/**
 * legacy.components-2-5 占位组件（文档协议 8.5）。
 * 由 Legacy Importer 生成，不可用户创建；只显示"待转换旧组件"，
 * 不运行旧脚本/动作，原始 JSON 保留在 Props 中。
 */

import { defineComponent } from "../../registry/defineComponent";
import type { ComponentDefinition } from "../../registry/definition";
import type { ComponentManifest } from "../../registry/definition";
import type { ComponentType, IconName, JsonObject } from "@ocs/contracts";
import type { JsonObjectSchema } from "../../schema/validator";
import type { ValidationIssue, ValidationResult } from "@ocs/contracts";
import { validateAgainstSchema } from "../../schema/validator";
import type { ComponentInspectorProps, ComponentRendererProps } from "../../registry/definition";

export interface LegacyComponents25Props {
  readonly legacyType: string;
  readonly legacyNode: JsonObject;
  readonly sourceRawHash: string;
}

export const legacyManifest: ComponentManifest = {
  type: "legacy.components-2-5" as ComponentType,
  specVersion: 1,
  displayName: "待转换旧组件",
  description: "Components 2.5 遗留组件占位（只读，原始 JSON 保留）",
  category: "custom",
  icon: "archive" as IconName,
  keywords: ["legacy", "2.5", "旧组件", "迁移"],
  vendor: "components-studio",
  packageVersion: "0.1.0",
  rootAllowed: false,
  userCreatable: false,
  declaredCapabilities: [],
};

export const legacyPropsSchema: JsonObjectSchema = {
  type: "object",
  properties: {
    legacyType: { type: "string", minLength: 1, maxLength: 200 },
    legacyNode: { type: "object", properties: {}, required: [], additionalProperties: true as const },
    sourceRawHash: { type: "string", minLength: 1, maxLength: 64 },
  },
  required: ["legacyType", "legacyNode", "sourceRawHash"],
  additionalProperties: false,
};

export function validateLegacyProps(input: unknown): ValidationResult<LegacyComponents25Props> {
  const issues: ValidationIssue[] = [];
  validateAgainstSchema(input, legacyPropsSchema, {}, issues, "$");
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as LegacyComponents25Props, warnings: [] };
}

function LegacyRenderer(props: ComponentRendererProps<LegacyComponents25Props>) {
  const { props: p } = props;
  return (
    <div className="ocs-legacy-placeholder" role="note">
      <div className="ocs-legacy-title">待转换旧组件</div>
      <div className="ocs-legacy-meta">
        旧类型：{p.legacyType} · 原始 JSON 已保留（只读）
      </div>
      <div className="ocs-legacy-hint">需要人工迁移为受控组件定义</div>
    </div>
  );
}

function LegacyInspector(_props: ComponentInspectorProps<LegacyComponents25Props>) {
  return (
    <div className="ocs-inspector">
      <p className="ocs-inspector-muted">
        旧组件占位只读：Props/Binding/Event/扩展不可修改。可移动、复制、删除或导出。
      </p>
    </div>
  );
}

export const legacyComponents25Definition: ComponentDefinition<LegacyComponents25Props> =
  defineComponent({
    manifest: legacyManifest,
    propsSchema: legacyPropsSchema,
    slots: [],
    events: [],
    bindableTargets: [],
    migrations: [],
    createCompanionDataSources: () => [],
    createDefaultProps: () => ({
      legacyType: "unknown",
      legacyNode: {},
      sourceRawHash: "0".repeat(64),
    }),
    validate: validateLegacyProps,
    Renderer: LegacyRenderer,
    Inspector: LegacyInspector,
  });


