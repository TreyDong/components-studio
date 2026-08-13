/**
 * ComponentsFileView 数据安全回归测试：
 * 同一 leaf 切换到不同路径时必须重建 binding（acquire 新路径）。
 * 否则 getViewData 返回旧 session 序列化，Obsidian 保存时把旧文件
 * 内容写到新路径——曾导致测试库文件被 Home 内容覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentId, DocumentSessionV1 } from "@ocs/contracts";
import { FakePlatformPort } from "../runtime/fakes";

const acquired: string[] = [];

const { ComponentsFileView } = await import(
  "../../src/platform/obsidian/ComponentsFileView"
);

describe("ComponentsFileView 路径切换", () => {
  let view: InstanceType<typeof ComponentsFileView>;

  beforeEach(() => {
    acquired.length = 0;
    const factory = {
      acquire: vi.fn(async (path: string) => {
        acquired.push(path);
        return { ok: true as const, value: fakeSession(path) };
      }),
      release: vi.fn(async () => ({ ok: true as const, value: undefined })),
      get: () => null,
      getSessionCount: () => 0,
      dispose: async () => ({ ok: true as const, value: undefined }),
    };
    view = new ComponentsFileView({} as never, () => ({
      factory,
      codec: {
        serialize: () => ({ ok: true as const, value: "{}" }),
      } as never,
      registry: {} as never,
      platform: new FakePlatformPort() as unknown as import("../../src/platform/ports").PlatformPort,
      hostIdPrefix: "test",
      servicesFactory: ((input: unknown) => input) as never,
    })) as InstanceType<typeof ComponentsFileView>;
  });

  afterEach(() => {
    void view.onClose();
  });

  it("同 leaf 切换路径时重建 binding，acquire 新路径", async () => {
    await view.onOpen();
    Object.defineProperty(view, "file", {
      get: () => ({ path: "a.components", basename: "a" }),
      configurable: true,
    });
    await view.setViewData("{}", false);
    expect(acquired).toEqual(["a.components"]);

    // 切换文件：Obsidian 更新 this.file 后再次 setViewData
    Object.defineProperty(view, "file", {
      get: () => ({ path: "b.components", basename: "b" }),
      configurable: true,
    });
    await view.setViewData("{}", false);
    // 修复前：只 acquire 了一次（binding 复用 a 的 session）→ 数据安全事故
    expect(acquired).toEqual(["a.components", "b.components"]);
  });

  it("同路径重复 setViewData 不重建", async () => {
    await view.onOpen();
    Object.defineProperty(view, "file", {
      get: () => ({ path: "a.components", basename: "a" }),
      configurable: true,
    });
    await view.setViewData("{}", false);
    await view.setViewData("{}", false);
    expect(acquired).toEqual(["a.components"]);
  });
});

function fakeSession(path: string): DocumentSessionV1 {
  return {
    documentId: path as DocumentId,
    getPath: () => path,
    getSnapshot: () => ({ documentId: path }) as never,
    getSessionVersion: () => 1,
    getContentHash: () => "hash",
    getStatus: () => ({ kind: "ready", dirty: false, reasons: [] }),
    subscribe: () => () => {},
    dispatch: () => ({ ok: false, error: { code: "CMD_SESSION_NOT_EDITABLE", message: "", scope: "session", recoverable: false, retryable: false } }),
    canUndo: () => false,
    canRedo: () => false,
    undo: () => ({ ok: false, error: { code: "CMD_SESSION_NOT_EDITABLE", message: "", scope: "session", recoverable: false, retryable: false } }),
    redo: () => ({ ok: false, error: { code: "CMD_SESSION_NOT_EDITABLE", message: "", scope: "session", recoverable: false, retryable: false } }),
    save: async () => ({ ok: true, value: { kind: "no-op", reason: "clean", snapshot: { path, text: "", rawHash: "", mtimeMs: 0, sizeBytes: 0 } } }),
    resolveConflict: async () => ({ ok: true, value: undefined }),
    saveCopy: async () => ({ ok: true, value: { path, text: "", rawHash: "", mtimeMs: 0, sizeBytes: 0 } }),
    dispose: async () => ({ ok: true, value: undefined }),
  };
}
