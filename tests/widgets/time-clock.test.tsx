/**
 * time.clock 测试（《运行时与 SDK 协议 v1》第 9.7 节）。
 * 覆盖：Schema 正反例（无效 IANA 时区 / BCP 47 locale 字段级错误）、
 * ready 渲染 <time dateTime>、showSeconds 选择 aligned second、
 * effectiveVisible=false 释放 scheduler、恢复时重新读取 now、
 * capability-denied 状态。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { TimeClockRenderer, formatClock } from "../../src/widgets/time-clock/Renderer";
import { timeClockDefinition, clockDefaultProps } from "../../src/widgets/time-clock";
import type { ClockProps } from "../../src/widgets/time-clock";
import type { ComponentRendererProps } from "../../src/registry/definition";
import type { ComponentRuntimeApi, NodeVisibilityPort } from "../../src/runtime/types";
import type { ComponentId } from "@ocs/contracts";

const NOW_MS = Date.UTC(2026, 7, 13, 14, 5, 33);

const mounted: { root: Root; container: HTMLDivElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted) {
    root.unmount();
    container.remove();
  }
  mounted.length = 0;
});

/** 可控可见性端口：缓存快照引用（useSyncExternalStore 要求），可切换并通知。 */
function makeVisibility(initial: boolean): NodeVisibilityPort & { setVisible(v: boolean): void } {
  let snapshot = {
    hostVisible: initial,
    ancestorVisible: initial,
    nodeEnabled: true,
    nodeStyleVisible: true,
    activeInLayout: initial,
    effectiveVisible: initial,
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setVisible: (v: boolean) => {
      snapshot = {
        hostVisible: v,
        ancestorVisible: v,
        nodeEnabled: true,
        nodeStyleVisible: true,
        activeInLayout: v,
        effectiveVisible: v,
      };
      for (const listener of listeners) listener();
    },
  };
}

function makeRuntime(overrides: Partial<ComponentRuntimeApi> = {}): {
  runtime: ComponentRuntimeApi;
  timers: {
    nowMs: ReturnType<typeof vi.fn>;
    aligned: ReturnType<typeof vi.fn>;
  };
} {
  const timers = {
    nowMs: vi.fn(() => NOW_MS),
    timeout: vi.fn(),
    interval: vi.fn(),
    aligned: vi.fn(() => ({ dispose: vi.fn() })),
  };
  const runtime = {
    timers,
    getCapability: vi.fn(() => ({
      capability: "timer:use",
      granted: true,
      source: "built-in-policy",
      reason: "",
    })),
    ...overrides,
  } as unknown as ComponentRuntimeApi;
  return { runtime, timers };
}

function baseProps(overrides: Partial<ComponentRendererProps<ClockProps>> = {}) {
  return {
    id: "c1" as ComponentId,
    props: clockDefaultProps(),
    mode: "view" as const,
    sourcePath: "home.components",
    location: {
      parentId: null,
      slotName: null,
      childIndex: null,
      placement: null,
      depth: 0,
      ancestry: [],
    },
    slots: {
      has: () => false,
      getChildren: () => [],
      render: () => null,
      renderChild: () => null,
    },
    runtime: {} as unknown as ComponentRuntimeApi,
    visibility: makeVisibility(true),
    ...overrides,
  };
}

function renderClock(props: ComponentRendererProps<ClockProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(TimeClockRenderer, props));
  });
  mounted.push({ root, container });
  return { container };
}

describe("time.clock Schema", () => {
  it("默认 Props 通过；显式 locale/时区通过", () => {
    expect(timeClockDefinition.validate(clockDefaultProps()).ok).toBe(true);
    const explicit = {
      ...clockDefaultProps(),
      locale: "en-US",
      timeZone: "Asia/Shanghai",
      hourCycle: "h12",
    };
    expect(timeClockDefinition.validate(explicit).ok).toBe(true);
  });

  it("反例：非法 hourCycle / 无效 IANA 时区（字段级错误）", () => {
    const badCycle = { ...clockDefaultProps(), hourCycle: "h24" } as unknown as ClockProps;
    expect(timeClockDefinition.validate(badCycle).ok).toBe(false);

    const badTz = { ...clockDefaultProps(), timeZone: "Not/AZone" } as unknown as ClockProps;
    const tzResult = timeClockDefinition.validate(badTz);
    expect(tzResult.ok).toBe(false);
    if (!tzResult.ok) {
      expect(tzResult.issues.some((issue) => issue.pointer === "/timeZone")).toBe(true);
    }
  });

  it("反例：无效 BCP 47 locale（字段级错误）", () => {
    const badLocale = { ...clockDefaultProps(), locale: "not a locale!!" } as unknown as ClockProps;
    const result = timeClockDefinition.validate(badLocale);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.pointer === "/locale")).toBe(true);
    }
  });

  it("反例：缺字段失败", () => {
    const missing = { ...clockDefaultProps() } as unknown as Record<string, unknown>;
    delete missing.label;
    expect(timeClockDefinition.validate(missing).ok).toBe(false);
  });
});

describe("formatClock", () => {
  it("showDate=false 时分精确；showSeconds 控制秒", () => {
    const base: ClockProps = { ...clockDefaultProps(), locale: "en-US", timeZone: "UTC", showDate: false };
    expect(formatClock(base, NOW_MS)).toBe("14:05");
    expect(formatClock({ ...base, showSeconds: true }, NOW_MS)).toBe("14:05:33");
  });

  it("h12 小时制生效", () => {
    const base: ClockProps = { ...clockDefaultProps(), locale: "en-US", timeZone: "UTC", showDate: false, hourCycle: "h12" };
    expect(formatClock(base, NOW_MS)).toBe("02:05 PM");
  });
});

describe("time.clock Renderer", () => {
  it("ready：立即读取 nowMs、aligned minute、<time dateTime=UTC ISO> 文本一致", () => {
    const { runtime, timers } = makeRuntime();
    const { container } = renderClock(
      baseProps({
        props: {
          ...clockDefaultProps(),
          locale: "en-US",
          timeZone: "UTC",
          showDate: false,
          label: "我的时钟",
        },
        runtime,
      }),
    );

    expect(timers.nowMs).toHaveBeenCalled();
    expect(timers.aligned).toHaveBeenCalledWith(expect.any(Function), "minute");

    const timeEl = container.querySelector("time.ocs-clock");
    expect(timeEl).not.toBeNull();
    expect(timeEl?.getAttribute("dateTime")).toBe("2026-08-13T14:05:33.000Z");
    expect(timeEl?.textContent).toBe("14:05");
    expect(timeEl?.getAttribute("aria-label")).toBe("我的时钟");
  });

  it("showSeconds=true：aligned second 且文本含秒", () => {
    const { runtime, timers } = makeRuntime();
    const { container } = renderClock(
      baseProps({
        props: {
          ...clockDefaultProps(),
          locale: "en-US",
          timeZone: "UTC",
          showDate: false,
          showSeconds: true,
        },
        runtime,
      }),
    );
    expect(timers.aligned).toHaveBeenCalledWith(expect.any(Function), "second");
    expect(container.querySelector("time.ocs-clock")?.textContent).toBe("14:05:33");
  });

  it("effectiveVisible=false 释放 scheduler；恢复时立即重新读取并重新对齐", () => {
    const { runtime, timers } = makeRuntime();
    const visibility = makeVisibility(true);
    const props = baseProps({
      props: { ...clockDefaultProps(), locale: "en-US", timeZone: "UTC", showDate: false },
      runtime,
      visibility,
    });
    const { container } = renderClock(props);

    // 挂载：useState 初始读取 1 次 + effect 立即读取 1 次（第 9.7 节“恢复时立即读取”）。
    expect(timers.nowMs).toHaveBeenCalledTimes(2);
    expect(timers.aligned).toHaveBeenCalledTimes(1);
    const dispose = timers.aligned.mock.results[0]!.value.dispose;

    // 隐藏：effect cleanup 释放 scheduler，不启动新调度器，不读取。
    act(() => {
      visibility.setVisible(false);
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(timers.aligned).toHaveBeenCalledTimes(1);
    expect(timers.nowMs).toHaveBeenCalledTimes(2);

    // 恢复：立即读取 now 并重新对齐。
    act(() => {
      visibility.setVisible(true);
    });
    expect(timers.nowMs).toHaveBeenCalledTimes(3);
    expect(timers.aligned).toHaveBeenCalledTimes(2);
    expect(container.querySelector("time.ocs-clock")).not.toBeNull();
  });

  it("capability-denied：不启动 scheduler，渲染拒绝态", () => {
    const { runtime, timers } = makeRuntime({
      getCapability: vi.fn(
        (): import("@ocs/contracts").JsonObject => ({
          capability: "timer:use",
          granted: false,
          source: "global-deny",
          reason: "denied",
        }),
      ) as unknown as ComponentRuntimeApi["getCapability"],
    });
    const { container } = renderClock(baseProps({ runtime }));
    expect(timers.aligned).not.toHaveBeenCalled();
    expect(container.querySelector(".ocs-clock-denied")).not.toBeNull();
    expect(container.querySelector("time.ocs-clock")).toBeNull();
  });
});
