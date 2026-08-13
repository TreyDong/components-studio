/**
 * core.nav-list 导航列表组件（受控迁移：替代 2.5 custom 代码组件）。
 *
 * 功能等价于旧"目录列表"：label/icon/link 列表，点击打开 Vault 内笔记。
 * - link 支持 `[[内部链接]]` 或 Vault 相对路径。
 * - 打开使用 scoped Navigation（workspace:navigate 能力）。
 * - 不渲染任意 HTML/图标 SVG；icon 是受控 Icon Registry 名。
 */

import { defineComponent } from "../../registry/defineComponent";
import type { ComponentDefinition } from "../../registry/definition";
import type { ComponentManifest } from "../../registry/definition";
import type { ComponentType, IconName } from "@ocs/contracts";
import type { JsonObjectSchema } from "../../schema/validator";
import type { ValidationIssue, ValidationResult } from "@ocs/contracts";
import { validateAgainstSchema } from "../../schema/validator";
import { useState } from "react";
import type { ComponentInspectorProps, ComponentRendererProps } from "../../registry/definition";

export interface NavListItem {
  readonly label: string;
  readonly icon: string;
  readonly link: string;
}

export interface NavListProps {
  readonly title: string;
  readonly items: readonly NavListItem[];
  readonly showIcons: boolean;
  readonly emptyText: string;
}

export const navListManifest: ComponentManifest = {
  type: "core.nav-list" as ComponentType,
  specVersion: 1,
  displayName: "导航列表",
  description: "目录/导航列表：点击打开 Vault 内笔记",
  category: "content",
  icon: "list" as IconName,
  keywords: ["nav", "list", "导航", "目录", "链接"],
  vendor: "components-studio",
  packageVersion: "0.1.0",
  rootAllowed: false,
  userCreatable: true,
  declaredCapabilities: ["workspace:navigate"],
};

export const navListPropsSchema: JsonObjectSchema = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: 120 },
    items: {
      type: "array",
      minItems: 0,
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          label: { type: "string", minLength: 1, maxLength: 80 },
          icon: { type: "string", maxLength: 64 },
          link: { type: "string", minLength: 1, maxLength: 1024 },
        },
        required: ["label", "icon", "link"],
        additionalProperties: false,
      },
    },
    showIcons: { type: "boolean" },
    emptyText: { type: "string", maxLength: 300 },
  },
  required: ["title", "items", "showIcons", "emptyText"],
  additionalProperties: false,
};

export function navListDefaultProps(): NavListProps {
  return {
    title: "",
    items: [],
    showIcons: true,
    emptyText: "暂无导航项",
  };
}

export function validateNavListProps(input: unknown): ValidationResult<NavListProps> {
  const issues: ValidationIssue[] = [];
  validateAgainstSchema(input, navListPropsSchema, {}, issues, "$");
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as NavListProps, warnings: [] };
}

/** 解析链接：`[[x]]` → x；其余原样（Vault 相对路径）。 */
export function resolveNavLink(link: string): string {
  const m = link.match(/^\[\[(.+)\]\]$/);
  return m ? m[1]! : link;
}

export function NavListRenderer(props: ComponentRendererProps<NavListProps>) {
  const { props: p, runtime } = props;
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const [errorLabel, setErrorLabel] = useState<string | null>(null);

  const open = async (item: NavListItem): Promise<void> => {
    if (runtime.mode === "edit") return; // edit 模式只选择，不动作
    const path = resolveNavLink(item.link);
    setOpenLabel(item.label);
    setErrorLabel(null);
    const result = await runtime.navigation.openFile(path, {
      disposition: "current-tab",
    });
    setOpenLabel(null);
    if (!result.ok) {
      setErrorLabel(item.label);
    }
  };

  if (p.items.length === 0) {
    return <div className="ocs-nav-empty">{p.emptyText}</div>;
  }

  return (
    <nav className="ocs-nav-list" aria-label={p.title || "导航列表"}>
      {p.title && <div className="ocs-nav-title">{p.title}</div>}
      {errorLabel && (
        <div className="ocs-nav-error" role="alert">
          无法打开：{errorLabel}
        </div>
      )}
      <ul className="ocs-nav-items">
        {p.items.map((item, index) => (
          <li key={index} className="ocs-nav-item">
            <button
              type="button"
              className="ocs-nav-item-btn"
              onClick={() => void open(item)}
              disabled={openLabel === item.label}
              aria-busy={openLabel === item.label || undefined}
            >
              {p.showIcons && item.icon && (
                <span className="ocs-nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className="ocs-nav-label">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NavListInspector(props: ComponentInspectorProps<NavListProps>) {
  const { value, controller, issues } = props;
  const commit = (next: NavListProps, label: string): void => {
    controller.replace(next, { label, save: "debounced" });
  };
  return (
    <div className="ocs-inspector">
      {issues.length > 0 && (
        <ul className="ocs-inspector-issues">
          {issues.map((issue, i) => (
            <li key={i}>
              {issue.pointer}: {issue.message}
            </li>
          ))}
        </ul>
      )}
      <label className="ocs-field">
        <span>标题</span>
        <input
          type="text"
          value={value.title}
          onChange={(event) => commit({ ...value, title: event.target.value }, "修改标题")}
        />
      </label>
      <label className="ocs-field ocs-field-toggle">
        <span>显示图标</span>
        <input
          type="checkbox"
          checked={value.showIcons}
          onChange={(event) => commit({ ...value, showIcons: event.target.checked }, "切换图标")}
        />
      </label>
      <label className="ocs-field">
        <span>空状态文案</span>
        <input
          type="text"
          value={value.emptyText}
          onChange={(event) => commit({ ...value, emptyText: event.target.value }, "修改空文案")}
        />
      </label>
      <div className="ocs-field">
        <span>导航项（JSON 数组：label/icon/link）</span>
        <textarea
          rows={8}
          className="ocs-field-monospace"
          value={JSON.stringify(value.items, null, 2)}
          onChange={(event) => {
            try {
              const items = JSON.parse(event.target.value) as unknown;
              const r = validateNavListProps({ ...value, items: items as NavListItem[] });
              if (r.ok) {
                commit(r.value, "修改导航项");
              }
            } catch {
              // 编辑中 JSON 不完整：不提交，等合法后生效
            }
          }}
        />
      </div>
    </div>
  );
}

export const coreNavListDefinition: ComponentDefinition<NavListProps> = defineComponent({
  manifest: navListManifest,
  propsSchema: navListPropsSchema,
  slots: [],
  events: [],
  bindableTargets: [],
  migrations: [],
  createCompanionDataSources: () => [],
  createDefaultProps: () => navListDefaultProps(),
  validate: validateNavListProps,
  Renderer: NavListRenderer,
  Inspector: NavListInspector,
});


