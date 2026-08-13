/**
 * time.clock Renderer（《运行时与 SDK 协议 v1》第 9.7 节 Renderer 与状态）。
 *
 * - 状态：ready / capability-denied / error。
 * - 首次 visible render 立即读取 nowMs，不等第一个 tick。
 * - showSeconds=true 使用 aligned second；false 使用 aligned minute。
 * - 每次 tick 重新读取 nowMs，不累加本地秒数（避免后台休眠漂移）。
 * - effectiveVisible=false 释放 scheduler；恢复时立即读取并重新对齐。
 * - <time dateTime="UTC ISO">：可见文本与机器时间对应同一 now。
 * - 不使用 aria-live（避免每秒播报）。
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ComponentRendererProps } from "../../registry/definition";
import type { ClockProps } from "./schema";

export function TimeClockRenderer(props: ComponentRendererProps<ClockProps>) {
  const { props: p, runtime, visibility } = props;

  const visibilitySnapshot = useSyncExternalStore(
    visibility.subscribe,
    visibility.getSnapshot,
    visibility.getSnapshot,
  );
  const granted = runtime.getCapability("timer:use").granted;
  // 首次渲染立即读取，不能等待第一个 tick。
  const [nowMs, setNowMs] = useState(() => runtime.timers.nowMs());

  useEffect(() => {
    if (!granted) return;
    if (!visibilitySnapshot.effectiveVisible) return;
    // 恢复可见时立即读取并重新对齐调度器。
    setNowMs(runtime.timers.nowMs());
    const timer = runtime.timers.aligned(
      () => {
        setNowMs(runtime.timers.nowMs());
      },
      p.showSeconds ? "second" : "minute",
    );
    return () => {
      void timer.dispose();
    };
  }, [granted, visibilitySnapshot.effectiveVisible, p.showSeconds, runtime]);

  if (!granted) {
    return <div className="ocs-clock ocs-clock-denied">需要计时器权限</div>;
  }

  let formatted: string;
  try {
    formatted = formatClock(p, nowMs);
  } catch {
    return (
      <div className="ocs-clock ocs-clock-error" role="alert">
        时钟格式化失败
      </div>
    );
  }

  return (
    <time
      className="ocs-clock"
      dateTime={new Date(nowMs).toISOString()}
      aria-label={p.label === "" ? undefined : p.label}
    >
      {formatted}
    </time>
  );
}

/**
 * 格式化（第 9.7 节）：showSeconds 明确控制秒；showDate 控制日期；
 * hourCycle 显式覆盖 locale 默认；timeZone/locale 的 "local"/"system" 哨兵省略对应参数。
 */
export function formatClock(p: ClockProps, nowMs: number): string {
  const date = new Date(nowMs);
  const locale = p.locale === "system" ? undefined : p.locale;
  const timeZone = p.timeZone === "local" ? undefined : p.timeZone;
  let formatted: string;
  if (p.showDate) {
    formatted = new Intl.DateTimeFormat(locale, {
      dateStyle: p.dateStyle,
      timeStyle: p.showSeconds ? "medium" : "short",
      hourCycle: p.hourCycle,
      timeZone,
    }).format(date);
  } else {
    formatted = new Intl.DateTimeFormat(locale, {
      hourCycle: p.hourCycle,
      hour: "2-digit",
      minute: "2-digit",
      ...(p.showSeconds ? { second: "2-digit" as const } : {}),
      timeZone,
    }).format(date);
  }
  return formatted;
}
