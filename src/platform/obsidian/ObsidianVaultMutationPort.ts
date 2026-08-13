/**
 * ObsidianVaultMutationPort —— Action Handler 修改 Markdown 的唯一入口
 * （《运行时与 SDK 协议 v1》第 4.4 节）。
 *
 * 本文件刻意不 import obsidian 运行时值（只依赖 obsidian-api.ts 的结构接口），
 * 因此可用纯对象 mock 直接测试。
 */

import type { ProtocolError, Result } from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import type {
  FrontmatterPatchOperation,
  PathRules,
  TextFileSnapshot,
  VaultMutationPort,
} from "../ports";
import type { MarkdownTaskLocator } from "../ports";
import { parentDir } from "./ObsidianPathRules";
import { patchFrontmatter } from "./frontmatter";
import { ok, sha256HexSync, type ObsidianVaultLike } from "./obsidian-api";

const PLATFORM_SCOPE = "platform" as const;

function err(
  code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
  message: string,
  options?: {
    readonly path?: string;
    readonly retryable?: boolean;
    readonly cause?: unknown;
  },
): { ok: false; error: ProtocolError } {
  return {
    ok: false,
    error: {
      code,
      message,
      scope: PLATFORM_SCOPE,
      recoverable: true,
      retryable: options?.retryable ?? true,
      path: options?.path,
      details: {},
      cause: options?.cause,
    },
  };
}

// ---------------------------------------------------------------------------

export interface ObsidianVaultMutationPortOptions {
  readonly vault: ObsidianVaultLike;
  readonly paths: PathRules;
}

export class ObsidianVaultMutationPort implements VaultMutationPort {
  private readonly vault: ObsidianVaultLike;
  readonly paths: PathRules;

  constructor(options: ObsidianVaultMutationPortOptions) {
    this.vault = options.vault;
    this.paths = options.paths;
  }

  async createText(input: {
    readonly path: string;
    readonly text: string;
    readonly createParents: boolean;
    readonly ifExists: "error" | "open-existing" | "append-number";
    readonly signal?: AbortSignal;
  }): Promise<Result<TextFileSnapshot>> {
    if (input.signal?.aborted) {
      return err(ERROR_CODES.STORAGE_WRITE_FAILED, "创建已取消", { path: input.path });
    }
    const normalized = this.paths.normalize(input.path);
    if (!normalized.ok) {
      return normalized;
    }
    const target = normalized.value;
    const existing = this.vault.getAbstractFileByPath(target);
    if (existing) {
      if (input.ifExists === "error") {
        return err(ERROR_CODES.SAVE_TARGET_EXISTS, `目标已存在：${target}`, {
          path: target,
          retryable: false,
        });
      }
      if (input.ifExists === "open-existing") {
        const text = await this.vault.read(existing);
        const stat = existing.stat ?? { ctime: 0, mtime: 0, size: text.length };
        return ok({
          path: target,
          text,
          rawHash: sha256HexSync(text),
          mtimeMs: stat.mtime,
          sizeBytes: stat.size,
        });
      }
      // append-number：在 stem 后追加 -2/-3…，直到不冲突。
      const dot = target.lastIndexOf(".");
      const stem = dot >= 0 ? target.slice(0, dot) : target;
      const ext = dot >= 0 ? target.slice(dot) : "";
      for (let i = 2; i < 1000; i++) {
        const candidate = `${stem}-${i}${ext}`;
        if (!this.vault.getAbstractFileByPath(candidate)) {
          return this.writeNewText(candidate, input.text);
        }
      }
      return err(ERROR_CODES.SAVE_TARGET_EXISTS, "无法生成不冲突的文件名", {
        path: target,
      });
    }
    if (input.createParents) {
      const parent = parentDir(target);
      if (parent.length > 0) {
        await this.ensureDirs(parent);
      }
    }
    return this.writeNewText(target, input.text);
  }

  async updateFrontmatter(input: {
    readonly path: string;
    readonly expectedFileText: string;
    readonly patch: Readonly<Record<string, FrontmatterPatchOperation>>;
    readonly signal?: AbortSignal;
  }): Promise<Result<TextFileSnapshot>> {
    if (input.signal?.aborted) {
      return err(ERROR_CODES.STORAGE_WRITE_FAILED, "更新已取消", { path: input.path });
    }
    const normalized = this.paths.normalize(input.path);
    if (!normalized.ok) {
      return normalized;
    }
    const path = normalized.value;
    const file = this.vault.getAbstractFileByPath(path);
    if (!file?.stat) {
      return err(ERROR_CODES.EXTERNAL_FILE_DELETED, `文件不存在：${path}`, { path });
    }
    let nextText = "";
    let conflicted = false;
    try {
      await this.vault.process(file, (current) => {
        // 同回调内：完整文本严格比较 + 生成新文本（纯函数）。
        if (current !== input.expectedFileText) {
          conflicted = true;
          return current;
        }
        const patched = patchFrontmatter(current, input.patch);
        if (!patched.ok) {
          conflicted = true;
          return current;
        }
        nextText = patched.value;
        return nextText;
      });
    } catch (cause) {
      return err(ERROR_CODES.STORAGE_WRITE_FAILED, `更新 frontmatter 失败：${path}`, {
        path,
        cause,
      });
    }
    if (conflicted) {
      return err(ERROR_CODES.ACTION_FRONTMATTER_CONFLICT, `frontmatter 已变化：${path}`, {
        path,
        retryable: true,
      });
    }
    return this.verifyWritten(path, nextText);
  }

  async updateMarkdownTask(input: {
    readonly locator: MarkdownTaskLocator;
    readonly nextStatus: string;
    readonly signal?: AbortSignal;
  }): Promise<Result<TextFileSnapshot>> {
    if (input.signal?.aborted) {
      return err(ERROR_CODES.STORAGE_WRITE_FAILED, "更新已取消", { path: input.locator.path });
    }
    const normalized = this.paths.normalize(input.locator.path);
    if (!normalized.ok) {
      return normalized;
    }
    const path = normalized.value;
    // nextStatus 必须是单个非换行 Unicode 字符（第 4.4 节）。
    const chars = [...input.nextStatus];
    if (chars.length !== 1 || chars[0] === "\n" || chars[0] === "\r") {
      return err(ERROR_CODES.ACTION_TASK_CONFLICT, "nextStatus 必须是单个非换行字符", {
        path,
        retryable: false,
      });
    }
    const file = this.vault.getAbstractFileByPath(path);
    if (!file?.stat) {
      return err(ERROR_CODES.EXTERNAL_FILE_DELETED, `文件不存在：${path}`, { path });
    }
    let currentText: string;
    try {
      currentText = await this.vault.read(file);
    } catch (cause) {
      return err(ERROR_CODES.STORAGE_READ_FAILED, `读取任务文件失败：${path}`, {
        path,
        cause,
      });
    }
    // 读取与 process 之间的变化仍会被完整文本 CAS 拒绝。
    if (sha256HexSync(currentText) !== input.locator.expectedRawHash) {
      return err(ERROR_CODES.ACTION_TASK_LOCATOR_STALE, "任务定位器已过期", {
        path,
        retryable: true,
      });
    }
    const nextText = applyTaskStatus(
      currentText,
      input.locator,
      input.nextStatus,
    );
    if (!nextText.ok) {
      return nextText;
    }
    let conflicted = false;
    try {
      await this.vault.process(file, (current) => {
        if (current !== currentText) {
          conflicted = true;
          return current;
        }
        return nextText.value;
      });
    } catch (cause) {
      return err(ERROR_CODES.STORAGE_WRITE_FAILED, `更新任务失败：${path}`, {
        path,
        cause,
      });
    }
    if (conflicted) {
      return err(ERROR_CODES.ACTION_TASK_CONFLICT, `任务行已变化：${path}`, {
        path,
        retryable: true,
      });
    }
    return this.verifyWritten(path, nextText.value);
  }

  private async writeNewText(
    path: string,
    text: string,
  ): Promise<Result<TextFileSnapshot>> {
    try {
      const created = await this.vault.create(path, text);
      const stat = created.stat ?? { ctime: 0, mtime: 0, size: text.length };
      const verified = await this.vault.read(created);
      if (verified !== text) {
        return err(ERROR_CODES.SAVE_VERIFY_FAILED, `写入后回读不一致：${path}`, {
          path,
        });
      }
      return ok({
        path,
        text: verified,
        rawHash: sha256HexSync(verified),
        mtimeMs: stat.mtime,
        sizeBytes: stat.size,
      });
    } catch (cause) {
      return err(ERROR_CODES.STORAGE_WRITE_FAILED, `创建文件失败：${path}`, {
        path,
        cause,
      });
    }
  }

  private async ensureDirs(parent: string): Promise<void> {
    const adapter = this.vault.adapter;
    if (!adapter) {
      return;
    }
    const segments = parent.split("/");
    let cursor = "";
    for (const segment of segments) {
      cursor = cursor.length === 0 ? segment : `${cursor}/${segment}`;
      if (this.vault.getAbstractFileByPath(cursor)) {
        continue;
      }
      try {
        await adapter.mkdir(cursor);
      } catch {
        // 并发创建可能已存在。
      }
    }
  }

  private async verifyWritten(
    path: string,
    expected: string,
  ): Promise<Result<TextFileSnapshot>> {
    let text: string;
    let stat: { ctime: number; mtime: number; size: number };
    try {
      const file = this.vault.getAbstractFileByPath(path);
      if (!file) {
        return err(ERROR_CODES.EXTERNAL_FILE_DELETED, `文件不存在：${path}`, { path });
      }
      text = await this.vault.read(file);
      stat = file.stat ?? { ctime: 0, mtime: 0, size: text.length };
    } catch (cause) {
      return err(ERROR_CODES.SAVE_IO_FAILED, `回读验证失败：${path}`, { path, cause });
    }
    if (text !== expected) {
      return err(ERROR_CODES.SAVE_VERIFY_FAILED, `回读文本不一致：${path}`, { path });
    }
    return ok({
      path,
      text,
      rawHash: sha256HexSync(text),
      mtimeMs: stat.mtime,
      sizeBytes: stat.size,
    });
  }
}

/**
 * 在完整文本上应用任务状态切换。行号/整行/状态字符/blockId 全部验证
 * （第 4.4 节）；任何不符返回 ACTION_TASK_CONFLICT。
 */
export function applyTaskStatus(
  text: string,
  locator: MarkdownTaskLocator,
  nextStatus: string,
): Result<string> {
  const lines = text.split("\n");
  const line = lines[locator.line];
  if (line === undefined || line !== locator.expectedLineText) {
    return err(ERROR_CODES.ACTION_TASK_CONFLICT, "任务行号或行内容已变化", {
      path: locator.path,
      retryable: true,
    });
  }
  const match = /^(\s*[-*+]\s+\[)(.)(\]\s*.*)$/.exec(line);
  if (!match) {
    return err(ERROR_CODES.ACTION_TASK_CONFLICT, "行不是任务行", {
      path: locator.path,
      retryable: false,
    });
  }
  if (match[2] !== locator.expectedStatus) {
    return err(ERROR_CODES.ACTION_TASK_CONFLICT, "任务状态字符已变化", {
      path: locator.path,
      retryable: true,
    });
  }
  if (locator.blockId !== null && !line.includes(`^${locator.blockId}`)) {
    return err(ERROR_CODES.ACTION_TASK_CONFLICT, "任务 blockId 已变化", {
      path: locator.path,
      retryable: true,
    });
  }
  const nextLine = `${match[1]}${nextStatus}${match[3]}`;
  const nextLines = [...lines];
  nextLines[locator.line] = nextLine;
  return ok(nextLines.join("\n"));
}

