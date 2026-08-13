/**
 * SessionFactory（《文档与会话协议 v1》第 16.3 节 + 运行时协议第 4.6 节）。
 *
 * - 规范化路径为缓存 Key；同一路径多 Host 共享 Session，refCount 计数。
 * - acquire(path, { initialText })：initialText 直接 parse（视图内容）；
 *   缺省时从 Storage 读取；文件缺失返回 EXTERNAL_FILE_DELETED 由调用方创建
 *   （Phase 0：DocumentBuilder/DocumentFileCreator 是独立模块，Factory 只缓存）。
 * - Rename 时 Session 回调原子换 Key。
 * - 最后一个 release() 才 dispose Session。
 */

import type {
  DocumentId,
  DocumentSessionV1,
  ProtocolError,
  Result,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import type { DocumentCodec } from "../document/codec";
import type {
  ComponentsStoragePort,
  ClockPort,
} from "../platform/ports";
import type { RecoveryPortV1 } from "@ocs/contracts/document";
import { DocumentSession } from "./DocumentSession";
import { sessionError } from "./DocumentSession";

export interface SessionAcquireOptions {
  /** 来自 TextFileView.setViewData 的外部内容；缺省时从 Storage 读取。 */
  readonly initialText?: string;
  readonly now?: number;
}

export interface SessionFactory {
  acquire(
    path: string,
    options?: SessionAcquireOptions,
  ): Promise<Result<DocumentSessionV1>>;
  release(session: DocumentSessionV1): Promise<Result<void>>;
  get(path: string): DocumentSessionV1 | null;
  getSessionCount(): number;
  dispose(): Promise<Result<void>>;
}

export interface SessionFactoryDeps {
  readonly codec: DocumentCodec;
  readonly storage: ComponentsStoragePort;
  readonly recovery: RecoveryPortV1;
  readonly clock: ClockPort;
  readonly vaultId: string;
  readonly documentIdOf?: (path: string) => DocumentId | null;
}

interface CacheEntry {
  readonly session: DocumentSession;
  refCount: number;
}

export class CodecSessionFactory implements SessionFactory {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly deps: SessionFactoryDeps) {}

  async acquire(
    path: string,
    options?: SessionAcquireOptions,
  ): Promise<Result<DocumentSessionV1>> {
    const normalized = this.deps.storage.paths.normalize(path);
    if (!normalized.ok) {
      return {
        ok: false,
        error: sessionError(ERROR_CODES.STORAGE_READ_FAILED, "路径规范化失败", {
          scope: "storage",
          path,
          details: { cause: normalized.error.message },
        }),
      };
    }
    const key = normalized.value;
    const cached = this.cache.get(key);
    if (cached) {
      cached.refCount += 1;
      return { ok: true, value: cached.session };
    }

    const nowMs = options?.now ?? this.deps.clock.now();
    let parsed;
    let snapshot;

    if (options?.initialText !== undefined) {
      const bytes = new TextEncoder().encode(options.initialText);
      const parse = this.deps.codec.parseUtf8(bytes);
      if (!parse.ok) {
        return {
          ok: false,
          error: toProtocolError(parse.error, "初始文本解析失败"),
        };
      }
      parsed = parse.value;
      snapshot = {
        path: key,
        text: options.initialText,
        rawHash: parsed.rawHash,
        mtimeMs: nowMs,
        sizeBytes: bytes.length,
      };
    } else {
      const read = await this.deps.storage.readText(key);
      if (!read.ok) {
        if (read.error.details && read.error.details.missing === true) {
          return {
            ok: false,
            error: sessionError(ERROR_CODES.EXTERNAL_FILE_DELETED, "文件不存在，请先创建文档", {
              scope: "storage",
              path: key,
            }),
          };
        }
        return {
          ok: false,
          error: sessionError(ERROR_CODES.STORAGE_READ_FAILED, "读取文件失败", {
            scope: "storage",
            path: key,
            retryable: true,
            details: { cause: read.error.message },
          }),
        };
      }
      const parse = this.deps.codec.parseUtf8(new TextEncoder().encode(read.value.text));
      if (!parse.ok) {
        return {
          ok: false,
          error: toProtocolError(parse.error, "文件内容不是合法 V1 文档"),
        };
      }
      parsed = parse.value;
      snapshot = read.value;
    }

    const session = new DocumentSession({
      path: key,
      codec: this.deps.codec,
      storage: this.deps.storage,
      recovery: this.deps.recovery,
      clock: this.deps.clock,
      vaultId: this.deps.vaultId,
      nowMs,
      parsed,
      snapshot,
      onRename: (oldPath, newPath) => this.handleSessionRename(oldPath, newPath),
      onDisposed: (disposedPath) => this.handleSessionDisposed(disposedPath),
      documentIdOf: this.deps.documentIdOf,
    });
    this.cache.set(key, { session, refCount: 1 });
    return { ok: true, value: session };
  }

  async release(session: DocumentSessionV1): Promise<Result<void>> {
    for (const [key, entry] of this.cache) {
      if (entry.session === session) {
        entry.refCount -= 1;
        if (entry.refCount <= 0) {
          this.cache.delete(key);
          return session.dispose();
        }
        return { ok: true, value: undefined };
      }
    }
    // 已释放/未由本工厂管理：幂等成功
    return { ok: true, value: undefined };
  }

  get(path: string): DocumentSessionV1 | null {
    const normalized = this.deps.storage.paths.normalize(path);
    if (!normalized.ok) return null;
    return this.cache.get(normalized.value)?.session ?? null;
  }

  getSessionCount(): number {
    return this.cache.size;
  }

  async dispose(): Promise<Result<void>> {
    const sessions = [...this.cache.values()];
    this.cache.clear();
    let firstError: ProtocolError | null = null;
    for (const entry of sessions) {
      const result = await entry.session.dispose();
      if (!result.ok && !firstError) firstError = result.error;
    }
    return firstError
      ? { ok: false, error: firstError }
      : { ok: true, value: undefined };
  }

  /** Rename 时原子换 Key（13.3.2）。 */
  private handleSessionRename(oldPath: string, newPath: string): void {
    const entry = this.cache.get(oldPath);
    if (!entry) return;
    this.cache.delete(oldPath);
    this.cache.set(newPath, entry);
  }

  private handleSessionDisposed(path: string): void {
    this.cache.delete(path);
  }
}

function toProtocolError(error: ProtocolError, message: string): ProtocolError {
  return {
    ...error,
    message: `${message}: ${error.message}`,
  };
}

/** 便捷构造：供调用方装配 CodecSessionFactory。 */
export function createSessionFactory(deps: SessionFactoryDeps): SessionFactory {
  return new CodecSessionFactory(deps);
}
