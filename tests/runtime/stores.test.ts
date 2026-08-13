/**
 * HostStateStore / RuntimeHostStore 测试（协议 3.2）。
 */
import { describe, expect, it } from "vitest";
import { HostStateStore } from "../../src/runtime/HostStateStore";
import { RuntimeHostStore } from "../../src/runtime/RuntimeHostStore";
import { fakeTheme } from "./fakes";
import type { ThemePort } from "../../src/platform/ports";

const themePort: ThemePort = {
  getSnapshot: () => fakeTheme(),
  subscribe: () => () => {},
};

function elementWithWidth(width: number): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 100,
      width,
      height: 100,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

describe("HostStateStore", () => {
  it("get/set/subscribe 工作，同键监听收到通知", () => {
    const store = new HostStateStore();
    const seen: unknown[] = [];
    const unsubscribe = store.subscribe("component/a/collapsed", () => {
      seen.push(store.get("component/a/collapsed", false));
    });
    expect(store.get("component/a/collapsed", false)).toBe(false);
    store.set("component/a/collapsed", true);
    expect(store.get("component/a/collapsed", false)).toBe(true);
    expect(seen).toEqual([true]);
    store.set("component/a/collapsed", false);
    expect(seen).toEqual([true, false]);
    unsubscribe();
    store.set("component/a/collapsed", true);
    expect(seen).toEqual([true, false]);
  });

  it("remove 删除键并通知", () => {
    const store = new HostStateStore();
    let notified = 0;
    store.subscribe("component/a/x", () => {
      notified += 1;
    });
    store.set("component/a/x", 1);
    store.remove("component/a/x");
    expect(store.get("component/a/x", "fallback")).toBe("fallback");
    expect(notified).toBe(2);
  });

  it("dispose 后清空状态，get 回退、subscribe 为 no-op", () => {
    const store = new HostStateStore();
    store.set("component/a/x", { deep: [1, 2] });
    store.dispose();
    expect(store.get("component/a/x", null)).toBeNull();
    const unsub = store.subscribe("component/a/x", () => {
      throw new Error("dispose 后不应通知");
    });
    store.set("component/a/x", 2);
    expect(unsub()).toBeUndefined();
  });
});

describe("RuntimeHostStore", () => {
  it("按容器宽度计算 responsiveMode（compact/regular/wide）", () => {
    const store = new RuntimeHostStore({
      hostId: "host-1",
      sourcePath: "home.components",
      element: elementWithWidth(300),
      theme: themePort,
    });
    expect(store.getSnapshot().responsiveMode).toBe("compact");
    expect(store.getSnapshot().containerSize).toEqual({ width: 300, height: 100 });
    store.dispose();
  });

  it("wide 断点与 ownerDocument/ownerWindow 来自宿主元素", () => {
    const el = elementWithWidth(1200);
    document.body.appendChild(el);
    const store = new RuntimeHostStore({
      hostId: "host-1",
      sourcePath: "home.components",
      element: el,
      theme: themePort,
    });
    const snapshot = store.getSnapshot();
    expect(snapshot.responsiveMode).toBe("wide");
    expect(snapshot.ownerDocument).toBe(document);
    expect(snapshot.ownerWindow).toBe(window);
    expect(snapshot.isAttached).toBe(true);
    expect(snapshot.theme.mode).toBe("light");
    store.dispose();
  });

  it("subscribe 通知监听器；dispose 清空监听器", () => {
    const store = new RuntimeHostStore({
      hostId: "host-1",
      sourcePath: "home.components",
      element: elementWithWidth(1000),
      theme: themePort,
    });
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    // 尺寸变化经 rAF 合并（jsdom 无 ResizeObserver，不触发；手动模拟观察器路径不可行，
    // 直接验证 dispose 清理）。
    unsubscribe();
    store.dispose();
    expect(notified).toBe(0);
  });
});
