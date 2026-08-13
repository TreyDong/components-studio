/**
 * core.layout Renderer（《运行时与 SDK 协议 v1》第 9.1 节 Renderer 要点）。
 *
 * - stack：按 Slot 顺序垂直排列。
 * - columns：flex；equalWidth 时 grow=1；wrap 控制换行。
 * - grid：使用当前断点 GridRect，DOM 顺序始终为 Slot 顺序（绝对定位，无自动布局）。
 * - tabs：顶部 Tab；vertical-tabs：regular/wide 左侧，compact 自动转顶部横向 Tab。
 * - 活动 Tab 是 Editor/Runtime 状态：Phase 0 用组件本地 React 状态占位
 *   （Host 挂载默认第一项；当前项被删除后回退到第一项），
 *   Phase 1 接入 HostStateStore `component/<id>/active-tab`。
 * - 响应式断点 Phase 0 以窗口宽度近似（responsiveModeForWidth），
 *   Phase 1 由 Host 容器尺寸经 HostStateStore 提供。
 */

import { useEffect, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { ComponentRendererProps } from "../../registry/definition";
import type { ChildPlacement } from "../../registry/definition";
import { responsiveModeForWidth } from "@ocs/contracts";
import type { ComponentId, ResponsiveMode } from "@ocs/contracts";
import type { CoreLayoutProps } from "./schema";

interface ChildRefLike {
  readonly nodeId: ComponentId;
  readonly placement: ChildPlacement;
}

export function CoreLayoutRenderer(props: ComponentRendererProps<CoreLayoutProps>) {
  const { props: p, id, slots } = props;
  const responsive = useResponsiveMode();
  const children = slots.has("children") ? slots.getChildren("children") : [];

  // 活动 Tab：Phase 0 本地态占位（见文件头注释）。
  const [activeTab, setActiveTab] = useState(0);
  useEffect(() => {
    if (activeTab >= children.length) {
      setActiveTab(0);
    }
  }, [activeTab, children.length]);

  switch (p.mode) {
    case "stack":
      return (
        <div
          className="ocs-component-layout ocs-layout-stack"
          style={{ gap: p.gap, padding: p.padding }}
        >
          {slots.render("children", { empty: <div className="ocs-layout-empty">拖入组件</div> })}
        </div>
      );
    case "columns": {
      const classes = [
        "ocs-component-layout",
        "ocs-layout-columns",
        ...(p.columns.wrap ? ["wrap"] : []),
        ...(p.columns.equalWidth ? ["equal"] : []),
      ].join(" ");
      return (
        <div className={classes} style={{ gap: p.gap, padding: p.padding }}>
          {slots.render("children", {
            wrapper: "div",
            childClassName: "ocs-layout-col",
            empty: <div className="ocs-layout-empty">拖入组件</div>,
          })}
        </div>
      );
    }
    case "grid":
      return (
        <LayoutGrid props={p} slots={slots} responsive={responsive} padding={p.padding} />
      );
    case "tabs":
    case "vertical-tabs": {
      const compact = responsive === "compact";
      const vertical = p.mode === "vertical-tabs" && !compact && p.tabs.placement === "left";
      return (
        <div
          className={`ocs-component-layout ocs-layout-tabs${vertical ? " vertical" : " top"}`}
          style={{ padding: p.padding }}
        >
          <TabsWidget
            componentId={id}
            layoutProps={p}
            children={children}
            activeTab={activeTab}
            onSelect={setActiveTab}
            renderPanel={(child) => slots.renderChild(child)}
          />
        </div>
      );
    }
    default:
      return null;
  }
}

/** 断点 Phase 0 占位：窗口宽度近似；Phase 1 改由 Host 容器尺寸提供。 */
function useResponsiveMode(): ResponsiveMode {
  return responsiveModeForWidth(typeof window === "undefined" ? 840 : window.innerWidth);
}

function LayoutGrid(props: {
  props: CoreLayoutProps;
  slots: ComponentRendererProps<CoreLayoutProps>["slots"];
  responsive: ResponsiveMode;
  padding: number;
}) {
  const { props: p, slots, responsive, padding } = props;
  const children = slots.has("children") ? slots.getChildren("children") : [];
  const columns = p.grid.columns[responsive];
  const rows = children.reduce(
    (max, child) => Math.max(max, child.placement.grid[responsive].y + child.placement.grid[responsive].h),
    0,
  );
  return (
    <div
      className="ocs-component-layout ocs-layout-grid"
      style={{ position: "relative", minHeight: rows * p.grid.rowHeight + padding * 2, padding }}
    >
      {children.length === 0 ? (
        <div className="ocs-layout-empty">拖入组件</div>
      ) : (
        children.map((child) => {
          const rect = child.placement.grid[responsive];
          const cellStyle: CSSProperties = {
            position: "absolute",
            left: `${(rect.x / columns) * 100}%`,
            top: `${rect.y * p.grid.rowHeight}px`,
            width: `${(rect.w / columns) * 100}%`,
            height: `${rect.h * p.grid.rowHeight}px`,
          };
          return (
            <div key={child.nodeId} className="ocs-layout-grid-cell" style={cellStyle}>
              {slots.renderChild(child, { className: "ocs-layout-grid-child" })}
            </div>
          );
        })
      )}
    </div>
  );
}

interface TabsWidgetProps {
  readonly componentId: ComponentId;
  readonly layoutProps: CoreLayoutProps;
  readonly children: readonly ChildRefLike[];
  readonly activeTab: number;
  readonly onSelect: (index: number) => void;
  readonly renderPanel: (child: ChildRefLike) => ReactNode;
}

function TabsWidget(props: TabsWidgetProps) {
  const { componentId, layoutProps, children, activeTab, onSelect, renderPanel } = props;
  const tabs = children.map((child, i) => ({
    index: i,
    nodeId: child.nodeId,
    title: child.placement.tab.title ?? `标签 ${i + 1}`,
    disabled: child.placement.tab.disabled,
  }));

  const focusTab = (index: number): void => {
    const el = document.getElementById(`ocs-tab-${componentId}-${index}`);
    el?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const enabled = tabs.filter((t) => !t.disabled);
    if (enabled.length === 0) return;
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = event.key === "Home" ? enabled[0]! : enabled[enabled.length - 1]!;
      onSelect(target.index);
      focusTab(target.index);
      return;
    }
    if (delta === 0) return;
    event.preventDefault();
    let next = activeTab;
    do {
      next = (next + delta + tabs.length) % tabs.length;
    } while (tabs[next]?.disabled);
    focusTab(next);
    if (layoutProps.tabs.activation === "automatic") {
      onSelect(next);
    }
  };

  return (
    <div className="ocs-layout-tabs">
      <div role="tablist" aria-label="布局标签" className="ocs-layout-tablist" onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.nodeId}
            type="button"
            role="tab"
            id={`ocs-tab-${componentId}-${tab.index}`}
            aria-selected={tab.index === activeTab}
            aria-controls={`ocs-tabpanel-${componentId}-${tab.index}`}
            tabIndex={tab.index === activeTab ? 0 : -1}
            disabled={tab.disabled}
            className={`ocs-layout-tab${tab.index === activeTab ? " active" : ""}`}
            onClick={() => onSelect(tab.index)}
            onFocus={() => {
              if (layoutProps.tabs.activation === "automatic") onSelect(tab.index);
            }}
          >
            {tab.title}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.nodeId}
          role="tabpanel"
          id={`ocs-tabpanel-${componentId}-${tab.index}`}
          aria-labelledby={`ocs-tab-${componentId}-${tab.index}`}
          className="ocs-layout-tabpanel"
          hidden={tab.index !== activeTab}
        >
          {renderPanel(children[tab.index]!)}
        </div>
      ))}
    </div>
  );
}
