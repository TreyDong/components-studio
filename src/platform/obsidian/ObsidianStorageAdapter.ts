/**
 * ObsidianStorageAdapter —— `.components` 唯一写入 Port
 * （《运行时与 SDK 协议 v1》第 4.3 节 + 《文档与会话协议 v1》第 11 章）。
 *
 * 实现要点：
 * - readText：vault.read → 归一化快照（rawHash 用同步 SHA-256）。
 * - compareAndSwapText：严格文本 CAS。在 Vault.process() 的同步回调内
 *   逐 UTF-16 code unit 比较完整 current === expectedText；相等才返回
 *   nextText。rawHash 一律在回调外计算。写后回读验证。
 * - writeNewText：目标存在 → SAVE_TARGET_EXISTS；创建父目录；写后回读验证。
 * - subscribe：vault.on('modify'|'rename'|'delete'|'create') 按归一化路径过滤。
 */

import type {
  CasTextResultV1,
  FileSnapshotV1,
  ProtocolError,
  Result,
  StorageEventV1,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import type { ComponentsStoragePort, PathRules } from "../ports";
import { parentDir } from "./ObsidianPathRules";
import {
  ok,
  sha256HexSync,
  type ObsidianVaultLike,
  type StatLike,
  type TFileLike,
} from "./obsidian-api";

const STORAGE_SCOPE = "storage" as const;

function storageError(
  code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
  message: string,
  path?: string,
  cause?: unknown,
): { ok: false; error: ProtocolError } {
  return {
    ok: false,
    error: {
      code,
      message,
      scope: STORAGE_SCOPE,
      recoverable: true,
      retryable: true,
      path,
      details: {},
      cause,
    },
  };
}

export interface ObsidianStorageAdapterOptions {
  readonly vault: ObsidianVaultLike;
  readonly paths: PathRules;
}

function isTFileLike(
  value: TFileLike | null,
): value is TFileLike & { stat: StatLike } {
  return value !== null && typeof value.stat === "object" && value.stat !== null;
}

function snapshotOf(
  path: string,
  text: string,
  stat: StatLike,
): FileSnapshotV1 {
  return {
    path,
    text,
    rawHash: sha256HexSync(text),
    mtimeMs: stat.mtime,
    sizeBytes: stat.size,
  };
}

export class ObsidianStorageAdapter implements ComponentsStoragePort {
  readonly paths: PathRules;
  private readonly vault: ObsidianVaultLike;

  constructor(options: ObsidianStorageAdapterOptions) {
    this.vault = options.vault;
    this.paths = options.paths;
  }

  async readText(path: string): Promise<Result<FileSnapshotV1>> {
    const normalized = this.paths.normalize(path);
    if (!normalized.ok) {
      return normalized;
    }
    const file = this.vault.getAbstractFileByPath(normalized.value);
    if (!isTFileLike(file)) {
      return storageError(
        ERROR_CODES.EXTERNAL_FILE_DELETED,
        `文件不存在：${normalized.value}`,
        normalized.value,
      );
    }
    try {
      const text = await this.vault.read(file);
      return ok(snapshotOf(normalized.value, text, file.stat));
    } catch (cause) {
      return storageError(
        ERROR_CODES.STORAGE_READ_FAILED,
        `读取失败：${normalized.value}`,
        normalized.value,
        cause,
      );
    }
  }

  async compareAndSwapText(input: {
    path: string;
    expectedText: string;
    expectedRawHash: string;
    nextText: string;
  }): Promise<Result<CasTextResultV1>> {
    const normalized = this.paths.normalize(input.path);
    if (!normalized.ok) {
      return normalized;
    }
    const path = normalized.value;

    // 契约第 11.3-1 步：调用方状态损坏检查（hash 在回调外计算）。
    if (sha256HexSync(input.expectedText) !== input.expectedRawHash) {
      return storageError(
        ERROR_CODES.STORAGE_WRITE_FAILED,
        "CAS 调用方状态损坏：expectedText 的 SHA-256 与 expectedRawHash 不一致",
        path,
      );
    }

    const file = this.vault.getAbstractFileByPath(path);
    if (!isTFileLike(file)) {
      return ok({ kind: "missing" });
    }

    let conflicted = false;
    let currentOnConflict: string | null = null;
    try {
      await this.vault.process(file, (current) => {
        if (current === input.expectedText) {
          return input.nextText;
        }
        conflicted = true;
        currentOnConflict = current;
        return current;
      });
    } catch (cause) {
      return this.indeterminate(path, cause);
    }

    // 回调外：生成结果（hash 计算在 process 返回之后）。
    if (conflicted) {
      return ok({
        kind: "conflict",
        current: snapshotOf(path, currentOnConflict ?? "", file.stat),
      });
    }

    // 写后回读验证（契约第 11.3-5/6 步）。
    try {
      const verified = await this.vault.read(file);
      if (verified !== input.nextText) {
        return this.indeterminate(
          path,
          undefined,
          ERROR_CODES.SAVE_VERIFY_FAILED,
          "回读文本与 nextText 不一致",
        );
      }
      return ok({
        kind: "written",
        snapshot: snapshotOf(path, verified, file.stat),
      });
    } catch (cause) {
      return this.indeterminate(path, cause);
    }
  }

  async writeNewText(
    path: string,
    text: string,
  ): Promise<Result<FileSnapshotV1>> {
    const normalized = this.paths.normalize(path);
    if (!normalized.ok) {
      return normalized;
    }
    const target = normalized.value;
    if (isTFileLike(this.vault.getAbstractFileByPath(target))) {
      return storageError(
        ERROR_CODES.SAVE_TARGET_EXISTS,
        `目标已存在，不覆盖：${target}`,
        target,
      );
    }
    const parent = parentDir(target);
    if (parent.length > 0) {
      const created = await this.ensureParentDirs(parent);
      if (!created.ok) {
        return created;
      }
    }
    try {
      const created = await this.vault.create(target, text);
      const stat = created.stat ?? (await this.statOrFallback(target));
      const verified = await this.vault.read(created);
      if (verified !== text) {
        return storageError(
          ERROR_CODES.SAVE_VERIFY_FAILED,
          `写入后回读不一致：${target}`,
          target,
        );
      }
      return ok(snapshotOf(target, verified, stat));
    } catch (cause) {
      return storageError(
        ERROR_CODES.STORAGE_WRITE_FAILED,
        `写入失败：${target}`,
        target,
        cause,
      );
    }
  }

  subscribe(
    path: string,
    listener: (event: StorageEventV1) => void,
  ): () => void {
    const normalized = this.paths.normalize(path);
    const target = normalized.ok ? normalized.value : path;
    const onModify = (file: unknown): void => {
      const p = filePathOf(file);
      if (p === target) {
        listener({ kind: "modified", path: p });
      }
    };
    const onCreate = (file: unknown): void => {
      const p = filePathOf(file);
      if (p === target) {
        listener({ kind: "created", path: p });
      }
    };
    const onDelete = (file: unknown): void => {
      const p = filePathOf(file);
      if (p === target) {
        listener({ kind: "deleted", path: p });
      }
    };
    const onRename = (file: unknown, oldPath: unknown): void => {
      if (typeof oldPath === "string" && oldPath === target) {
        const newPath = filePathOf(file);
        listener({ kind: "renamed", oldPath: target, newPath });
      }
    };
    this.vault.on("modify", onModify);
    this.vault.on("create", onCreate);
    this.vault.on("delete", onDelete);
    this.vault.on("rename", onRename);
    return () => {
      this.vault.off("modify", onModify);
      this.vault.off("create", onCreate);
      this.vault.off("delete", onDelete);
      this.vault.off("rename", onRename);
    };
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private async indeterminate(
    path: string,
    cause: unknown,
    code?: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
    message?: string,
  ): Promise<Result<CasTextResultV1>> {
    let current: FileSnapshotV1 | null = null;
    try {
      const file = this.vault.getAbstractFileByPath(path);
      if (file) {
        const text = await this.vault.read(file);
        current = snapshotOf(
          path,
          text,
          file?.stat ?? { ctime: 0, mtime: 0, size: text.length },
        );
      }
    } catch {
      current = null;
    }
    return ok({
      kind: "indeterminate",
      current,
      error: {
        code: code ?? ERROR_CODES.SAVE_IO_FAILED,
        message: message ?? `写入结果不确定：${path}`,
        scope: STORAGE_SCOPE,
        recoverable: true,
        retryable: true,
        pointer: null,
        componentId: null,
        details: { path },
        cause,
      },
    });
  }

  private async ensureParentDirs(parent: string): Promise<Result<void>> {
    const adapter = this.vault.adapter;
    if (!adapter) {
      return storageError(
        ERROR_CODES.STORAGE_WRITE_FAILED,
        "Vault 未提供 adapter，无法创建父目录",
        parent,
      );
    }
    const segments = parent.split("/");
    let cursor = "";
    for (const segment of segments) {
      cursor = cursor.length === 0 ? segment : `${cursor}/${segment}`;
      if (this.vault.getAbstractFileByPath(cursor) !== null) {
        continue;
      }
      try {
        await adapter.mkdir(cursor);
      } catch (cause) {
        // 并发创建可能已存在：若现在能查到，视为成功。
        if (this.vault.getAbstractFileByPath(cursor) === null) {
          return storageError(
            ERROR_CODES.STORAGE_WRITE_FAILED,
            `创建父目录失败：${cursor}`,
            cursor,
            cause,
          );
        }
      }
    }
    return ok(undefined);
  }

  private async statOrFallback(path: string): Promise<StatLike> {
    const file = this.vault.getAbstractFileByPath(path);
    if (file?.stat) {
      return file.stat;
    }
    const adapter = this.vault.adapter;
    if (adapter) {
      try {
        const stat = await adapter.stat(path);
        if (stat) {
          return stat;
        }
      } catch {
        // 回退到零值 stat（mtime/size 仅用于诊断）。
      }
    }
    return { ctime: 0, mtime: 0, size: 0 };
  }
}

function filePathOf(file: unknown): string {
  if (
    typeof file === "object" &&
    file !== null &&
    "path" in file &&
    typeof file.path === "string"
  ) {
    return file.path;
  }
  return "";
}
