/**
 * Obsidian API 的最小结构化表面（structural surface）。
 *
 * 本模块只声明 Adapter 实际消费的 Obsidian 对象形状（Vault / TFile /
 * Workspace / Commands / DataAdapter）。真实 Obsidian 对象（obsidian.d.ts
 * 中的 Vault、TFile 等）结构上满足这些接口，因此：
 * - 生产代码把真实对象直接传入，不做 `as any` 类型断言；
 * - 测试可以用纯对象 mock 注入（tests/platform 不加载 Obsidian 运行时）。
 *
 * 按《运行时与 SDK 协议 v1》第 4 章，只有 platform/obsidian 与 plugin 允许
 * import obsidian；本模块刻意不 import obsidian 运行时值，只依赖结构兼容。
 */

import type {
  JsonValue,
  ProtocolError,
  Result,
  VaultId,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import { sha256HexSync } from "../../shared/hash";

export { sha256HexSync };

// ---------------------------------------------------------------------------
// 文件与 Vault
// ---------------------------------------------------------------------------

/** 与 obsidian FileStats 兼容的最小 stat。 */
export interface StatLike {
  readonly ctime: number;
  readonly mtime: number;
  readonly size: number;
}

/** 与 obsidian TFile 兼容的最小文件对象。 */
export interface TFileLike {
  readonly path: string;
  readonly name?: string;
  readonly stat?: StatLike;
}

/** 与 obsidian DataAdapter 兼容的最小文件系统适配器（config 目录读写）。 */
export interface DataAdapterLike {
  exists(normalizedPath: string): Promise<boolean>;
  read(normalizedPath: string): Promise<string>;
  write(normalizedPath: string, data: string): Promise<void>;
  rename(normalizedPath: string, normalizedNewPath: string): Promise<void>;
  remove(normalizedPath: string): Promise<void>;
  mkdir(normalizedPath: string): Promise<void>;
  list(normalizedPath: string): Promise<{ files: string[]; folders: string[] }>;
  stat(normalizedPath: string): Promise<StatLike | null>;
}

/** 与 obsidian Vault 兼容的最小 Vault 表面（storage + mutation 消费）。 */
export interface ObsidianVaultLike {
  readonly name?: string;
  readonly configDir?: string;
  readonly adapter?: DataAdapterLike;
  /** Obsidian 1.13：read 接受 TFile 对象（不是路径）。 */
  read(file: TFileLike): Promise<string>;
  process(
    file: TFileLike,
    fn: (data: string) => string,
    options?: Record<string, unknown>,
  ): Promise<string>;
  create(
    normalizedPath: string,
    data: string,
    options?: Record<string, unknown>,
  ): Promise<TFileLike>;
  createFolder(normalizedPath: string): Promise<unknown>;
  getAbstractFileByPath(normalizedPath: string): TFileLike | null;
  getFiles?(): readonly TFileLike[];
  on(
    name: string,
    callback: (...data: unknown[]) => unknown,
    ctx?: unknown,
  ): unknown;
  off(name: string, callback: (...data: unknown[]) => unknown): void;
}

/** 与 obsidian Commands 注册表兼容的最小表面（app.commands）。 */
export interface CommandsRegistryLike {
  listCommands(): readonly {
    id: string;
    name: string;
    pluginId?: string;
  }[];
  executeCommandById(commandId: string): Promise<void>;
}

/** 与 obsidian WorkspaceLeaf 兼容的最小 Leaf 表面。 */
export interface WorkspaceLeafLike {
  openFile(file: TFileLike, openState?: Record<string, unknown>): Promise<void>;
  getViewState?(): Record<string, unknown>;
  view?: unknown;
}

/** 与 obsidian Workspace 兼容的最小表面。 */
export interface WorkspaceLike {
  getActiveFile(): TFileLike | null;
  getLeaf(newLeaf?: string | boolean): WorkspaceLeafLike;
  getLeavesOfType(viewType: string): readonly WorkspaceLeafLike[];
  revealLeaf(leaf: WorkspaceLeafLike): Promise<void>;
  on(
    name: string,
    callback: (...data: unknown[]) => unknown,
    ctx?: unknown,
  ): unknown;
  off(name: string, callback: (...data: unknown[]) => unknown): void;
}

/** 与 obsidian App 兼容的最小表面。 */
export interface AppLike {
  readonly vault: ObsidianVaultLike;
  readonly workspace: WorkspaceLike;
  readonly metadataCache?: unknown;
  readonly commands?: CommandsRegistryLike;
  isDarkMode?(): boolean;
}

// ---------------------------------------------------------------------------
// 平台错误与 VaultId
// ---------------------------------------------------------------------------

const PLATFORM_SCOPE = "platform" as const;

export function platformError(
  code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
  message: string,
  options?: {
    readonly path?: string;
    readonly recoverable?: boolean;
    readonly retryable?: boolean;
    readonly details?: Readonly<Record<string, JsonValue>>;
    readonly cause?: unknown;
  },
): ProtocolError {
  return {
    code,
    message,
    scope: PLATFORM_SCOPE,
    recoverable: options?.recoverable ?? true,
    retryable: options?.retryable ?? true,
    path: options?.path,
    details: options?.details ?? {},
    cause: options?.cause,
  };
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(error: ProtocolError): { ok: false; error: ProtocolError } {
  return { ok: false, error };
}

/**
 * 从宿主派生稳定 VaultId（技术规格第 11.1 节：vaultId 必须来自宿主，
 * 而不是文档）。Obsidian 不公开稳定的 vault UUID，因此以
 * `vault 名称 + config 目录` 的 SHA-256 前 32 位作为每库稳定标识。
 * config 目录（vault.configDir）随库唯一，重命名库名会改变派生值；
 * 这是 Phase 0 的可接受权衡，后续可换成 Obsidian 提供的稳定标识。
 */
export function deriveVaultId(
  vaultName: string,
  configDir: string,
): VaultId {
  const seed = `${vaultName}\u0000${configDir}`;
  return sha256HexSync(seed).slice(0, 32) as VaultId;
}

let cachedNormalize: ((path: string) => string) | null = null;

/**
 * 惰性加载 Obsidian normalizePath。
 *
 * obsidian npm 包是 types-only（main 为空），vitest 无法解析其裸导入；
 * 因此可测试模块（路径规则、恢复端口）不在顶层 import obsidian，而是在
 * 首次需要时通过宿主注入的 `require` 获取：
 * - 生产（Obsidian 宿主，CJS bundle）：require("obsidian") 返回真实模块；
 * - 测试：抛出 → 回退恒等函数（测试总是注入自己的 normalize 实现）。
 */
export function lazyNormalizePath(path: string): string {
  if (cachedNormalize === null) {
    let impl: ((p: string) => string) | null = null;
    try {
      const hostRequire = (globalThis as { require?: (id: string) => unknown })
        .require;
      const mod = hostRequire ? hostRequire("obsidian") : null;
      if (
        mod &&
        typeof mod === "object" &&
        "normalizePath" in mod &&
        typeof mod.normalizePath === "function"
      ) {
        const candidate = mod.normalizePath;
        if (typeof candidate === "function") {
          impl = candidate as (p: string) => string;
        }
      }
    } catch {
      impl = null;
    }
    cachedNormalize = impl ?? ((p: string) => p);
  }
  return cachedNormalize(path);
}
