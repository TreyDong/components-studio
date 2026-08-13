/**
 * 内存 ComponentsStoragePortV1 双实现（测试/开发用）。
 *
 * 语义对齐《文档与会话协议 v1》第 11 章：
 * - CAS 是不可分割操作：校验 expectedText 的 SHA-256 等于 expectedRawHash，
 *   当前文本按 UTF-16 code unit 精确比较，不相等不写入并返回 conflict；
 *   相等则写入、回读验证，并发出 Modified 事件（供 Session 用 own-write hash 消重）。
 * - writeNewText 目标存在时不覆盖（SAVE_TARGET_EXISTS）。
 * - readText 缺失返回 STORAGE_READ_FAILED + details.missing（工厂映射为 EXTERNAL_FILE_DELETED）。
 */

import type {
  CasTextResultV1,
  FileSnapshotV1,
  ProtocolError,
  Result,
  StorageEventV1,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import type { PathRules, ComponentsStoragePort } from "../platform/ports";
import { sha256HexSync } from "../shared/hash";

interface MemFile {
  text: string;
  mtimeMs: number;
}

function err(code: string, message: string, details: import("@ocs/contracts").JsonObject = {}): { ok: false; error: ProtocolError } {
  return {
    ok: false,
    error: {
      code: code as ProtocolError["code"],
      message,
      scope: "storage",
      recoverable: true,
      retryable: true,
      details,
    },
  };
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

function snapshotOf(path: string, file: MemFile): FileSnapshotV1 {
  const bytes = new TextEncoder().encode(file.text);
  return {
    path,
    text: file.text,
    rawHash: sha256HexSync(file.text),
    mtimeMs: file.mtimeMs,
    sizeBytes: bytes.length,
  };
}

export const memoryPathRules: PathRules = {
  normalize(input: string): Result<string> {
    const cleaned = input.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
    if (cleaned.length === 0) {
      return err(ERROR_CODES.STORAGE_READ_FAILED, "空路径");
    }
    return ok(cleaned);
  },
  resolve(input: string, options: { readonly sourcePath: string; readonly defaultBase: "vault" | "source-directory" }): Result<string> {
    if (input.startsWith("/")) return ok(input.replace(/^\/+/, ""));
    if (options.defaultBase === "source-directory") {
      const parent = options.sourcePath.includes("/")
        ? options.sourcePath.slice(0, options.sourcePath.lastIndexOf("/") + 1)
        : "";
      return ok(parent + input);
    }
    return ok(input);
  },
  isInsideVault(_path: string): boolean {
    return true;
  },
};

export class MemoryStorage implements ComponentsStoragePort {
  readonly paths: PathRules = memoryPathRules;

  private readonly files = new Map<string, MemFile>();
  private readonly listeners = new Map<string, Set<(event: StorageEventV1) => void>>();
  private mtimeCounter = 1;
  private readonly casFailures = new Map<string, number>();
  /** 测试钩子：下一次 CAS 直接返回 indeterminate（key = 路径）。 */
  private nextIndeterminate = new Set<string>();

  // -------------------------------------------------------------------------
  // StoragePortV1
  // -------------------------------------------------------------------------

  async readText(path: string): Promise<Result<FileSnapshotV1>> {
    const file = this.files.get(path);
    if (!file) return err(ERROR_CODES.STORAGE_READ_FAILED, `文件不存在: ${path}`, { missing: true });
    return ok(snapshotOf(path, file));
  }

  async compareAndSwapText(input: {
    path: string;
    expectedText: string;
    expectedRawHash: string;
    nextText: string;
  }): Promise<Result<CasTextResultV1>> {
    if (this.nextIndeterminate.delete(input.path)) {
      const current = this.files.get(input.path);
      return ok({
        kind: "indeterminate",
        current: current ? snapshotOf(input.path, current) : null,
        error: {
          code: "STORAGE_WRITE_FAILED",
          message: "测试注入的 indeterminate",
          scope: "storage",
          recoverable: true,
          retryable: false,
          pointer: null,
          componentId: null,
          details: {},
        },
      });
    }
    const expectedHash = sha256HexSync(input.expectedText);
    if (expectedHash !== input.expectedRawHash) {
      return err(ERROR_CODES.SAVE_VERIFY_FAILED, "expectedText 与 expectedRawHash 不一致");
    }
    const current = this.files.get(input.path);
    if (!current) return ok({ kind: "missing" });
    if (current.text !== input.expectedText) {
      return ok({ kind: "conflict", current: snapshotOf(input.path, current) });
    }
    current.text = input.nextText;
    current.mtimeMs = ++this.mtimeCounter;
    this.emit("modified", input.path);
    return ok({ kind: "written", snapshot: snapshotOf(input.path, current) });
  }

  async writeNewText(path: string, text: string): Promise<Result<FileSnapshotV1>> {
    if (this.files.has(path)) {
      return err(ERROR_CODES.SAVE_TARGET_EXISTS, `目标已存在: ${path}`);
    }
    const file: MemFile = { text, mtimeMs: ++this.mtimeCounter };
    this.files.set(path, file);
    this.emit("created", path);
    return ok(snapshotOf(path, file));
  }

  subscribe(path: string, listener: (event: StorageEventV1) => void): () => void {
    let set = this.listeners.get(path);
    if (!set) {
      set = new Set();
      this.listeners.set(path, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
    };
  }

  // -------------------------------------------------------------------------
  // 测试辅助
  // -------------------------------------------------------------------------

  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  getText(path: string): string | null {
    return this.files.get(path)?.text ?? null;
  }

  getSnapshot(path: string): FileSnapshotV1 | null {
    const file = this.files.get(path);
    return file ? snapshotOf(path, file) : null;
  }

  /** 外部直接放置/覆盖文件，不发事件。 */
  putFile(path: string, text: string): void {
    this.files.set(path, { text, mtimeMs: ++this.mtimeCounter });
  }

  /** 外部修改：覆盖并触发 modified 事件。 */
  setExternalText(path: string, text: string): void {
    this.files.set(path, { text, mtimeMs: ++this.mtimeCounter });
    this.emit("modified", path);
  }

  removeFile(path: string): void {
    if (this.files.delete(path)) {
      this.emit("deleted", path);
    }
  }

  renameFile(oldPath: string, newPath: string): void {
    const file = this.files.get(oldPath);
    if (!file) return;
    file.mtimeMs = ++this.mtimeCounter;
    this.files.delete(oldPath);
    this.files.set(newPath, file);
    this.emit("renamed", oldPath, newPath);
    this.emit("modified", newPath);
  }

  /** 测试钩子：让下一次 CAS 返回 indeterminate。 */
  failNextCasAsIndeterminate(path: string): void {
    this.nextIndeterminate.add(path);
  }

  private emit(kind: "modified" | "deleted", path: string): void;
  private emit(kind: "renamed", oldPath: string, newPath: string): void;
  private emit(kind: "created", path: string): void;
  private emit(kind: string, a: string, b?: string): void {
    const event: StorageEventV1 =
      kind === "renamed"
        ? { kind: "renamed", oldPath: a, newPath: b! }
        : { kind: kind as "modified", path: a };
    const set = this.listeners.get(kind === "renamed" ? a : a);
    if (set) {
      for (const listener of [...set]) listener(event);
    }
    if (kind === "renamed" && b) {
      const newSet = this.listeners.get(b);
      if (newSet) {
        for (const listener of [...newSet]) listener({ kind: "modified", path: b });
      }
    }
  }
}

/** 便捷类型导出。 */
export type { StorageEventV1 };
