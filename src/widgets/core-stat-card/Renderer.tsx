/**
 * core.stat-card Renderer（《运行时与 SDK 协议 v1》第 9 节）。
 * 纯静态渲染：标题 + 数值 + 单位 + 趋势徽标 + 备注。
 * trend 徽标：up ▲ / down ▼ / flat —；accent 着色数值与徽标。
 */

import type { CSSProperties } from "react";
import type { ComponentRendererProps } from "../../registry/definition";
import type { StatCardProps, StatCardTrend } from "./schema";

const TREND_GLYPH: Record<StatCardTrend, string> = {
  up: "▲",
  down: "▼",
  flat: "—",
};

export function CoreStatCardRenderer({ props }: ComponentRendererProps<StatCardProps>) {
  const trend = props.trend ?? null;
  return (
    <article
      className="ocs-stat-card"
      data-trend={trend ?? undefined}
      style={props.accent ? { "--ocs-stat-accent": props.accent } as CSSProperties : undefined}
    >
      <header className="ocs-stat-card-head">
        <h3 className="ocs-stat-card-title">{props.title}</h3>
        {props.icon ? <span className="ocs-stat-card-icon" aria-hidden="true">{props.icon}</span> : null}
      </header>
      <p className="ocs-stat-card-value">
        {props.value}
        {props.unit ? <span className="ocs-stat-card-unit">{props.unit}</span> : null}
      </p>
      {trend || props.trendLabel ? (
        <div className="ocs-stat-card-foot">
          {trend ? <span className="ocs-stat-card-trend" aria-label={`趋势：${trend}`}>{TREND_GLYPH[trend]}</span> : null}
          {props.trendLabel ? <span className="ocs-stat-card-trend-label">{props.trendLabel}</span> : null}
        </div>
      ) : null}
      {props.note ? <p className="ocs-stat-card-note">{props.note}</p> : null}
    </article>
  );
}
