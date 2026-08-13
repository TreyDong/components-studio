/**
 * 测试用 Mock Vault（纯对象，结构满足 obsidian-api.ts 的 ObsidianVaultLike）。
 * 只实现 ObsidianStorageAdapter / VaultReadPort / VaultMutationPort 消费的表面。
 */

import type {
  DataAdapterLike,
  ObsidianVaultLike,
  StatLike,
  TFileLike,
} from "../../src/platform/obsidian/obsidian-api";
import { sha256HexSync } from "../../src/shared/hash";

export interface MockFile {
  readonly path: string;
  text: string;
  readonly ctime: number;
  mtime: number;
}

/** 简单 normalizePath mock（Obsidian 行为子集：`\`→`/`、折叠 `/`、去尾 `/`）。 */
export function mockNormalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

export class MockVault implements ObsidianVaultLike {
  readonly name = "mock-vault";
  readonly configDir = ".obsidian";
  readonly files = new Map<string, MockFile>();
  readonly folders = new Set<string>();
  readonly adapter: DataAdapterLike;
  /** 事件表：name → callbacks。 */
  readonly listeners = new Map<string, Set<(...args: unknown[]) => unknown>>();
  /** 注入 process 失败（模拟 IO 异常）。 */
  processError: Error | null = null;
  /** 注入 create 失败。 */
  createError: Error | null = null;
  /** 注入 read 失败。 */
  readError: Error | null = null;
  /** 注入 read 内容覆盖（返回 null 表示使用真实内容）。 */
  readOverride: ((path: string) => string | null) | null = null;
  /** 记录 process 回调收到的次数（用于断言"回调内比较"）。 */
  processCalls = 0;
  /** 已删除文件路径（用于验证 missing 语义）。 */
  deleted = new Set<string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [path, text] of Object.entries(initial)) {
      this.putFile(path, text);
    }
    this.adapter = new MockAdapter(this);
  }

  putFile(path: string, text: string): void {
    const normalized = mockNormalizePath(path);
    this.files.set(normalized, {
      path: normalized,
      text,
      ctime: 1000,
      mtime: 1000 + this.files.size,
    });
    this.deleted.delete(normalized);
    this.emit("create", { path: normalized });
  }

  deleteFile(path: string): void {
    const normalized = mockNormalizePath(path);
    this.files.delete(normalized);
    this.deleted.add(normalized);
    this.emit("delete", { path: normalized });
  }

  setText(path: string, text: string, mtime?: number): void {
    const normalized = mockNormalizePath(path);
    const file = this.files.get(normalized);
    if (file) {
      file.text = text;
      file.mtime = mtime ?? file.mtime + 1;
      this.emit("modify", { path: normalized });
    }
  }

  statOf(path: string): StatLike {
    const file = this.files.get(mockNormalizePath(path))!;
    return { ctime: file.ctime, mtime: file.mtime, size: file.text.length };
  }

  // --- ObsidianVaultLike ---

  read(file: TFileLike): Promise<string> {
    if (this.readError) {
      return Promise.reject(this.readError);
    }
    if (this.readOverride) {
      const override = this.readOverride(file.path);
      if (override !== null) {
        return Promise.resolve(override);
      }
    }
    const entry = this.files.get(file.path);
    if (!entry) {
      return Promise.reject(new Error(`ENOENT: ${file.path}`));
    }
    return Promise.resolve(entry.text);
  }

  process(
    file: TFileLike,
    fn: (data: string) => string,
  ): Promise<string> {
    this.processCalls += 1;
    if (this.processError) {
      return Promise.reject(this.processError);
    }
    const entry = this.files.get(file.path);
    if (!entry) {
      return Promise.reject(new Error(`ENOENT: ${file.path}`));
    }
    const next = fn(entry.text);
    if (next !== entry.text) {
      entry.text = next;
      entry.mtime += 1;
    }
    this.emit("modify", { path: file.path });
    return Promise.resolve(next);
  }

  create(
    normalizedPath: string,
    data: string,
  ): Promise<TFileLike> {
    if (this.createError) {
      return Promise.reject(this.createError);
    }
    const normalized = mockNormalizePath(normalizedPath);
    this.putFile(normalized, data);
    const segments = normalized.split("/");
    return Promise.resolve({
      path: normalized,
      name: segments[segments.length - 1] ?? normalized,
      stat: this.statOf(normalized),
    });
  }

  createFolder(): Promise<unknown> {
    return Promise.resolve({});
  }

  getAbstractFileByPath(normalizedPath: string): TFileLike | null {
    const normalized = mockNormalizePath(normalizedPath);
    const entry = this.files.get(normalized);
    if (!entry || this.deleted.has(normalized)) {
      return null;
    }
    return {
      path: normalized,
      name: (() => { const seg = normalized.split("/"); return seg[seg.length - 1] ?? normalized; })(),
      stat: {
        ctime: entry.ctime,
        mtime: entry.mtime,
        size: entry.text.length,
      },
    };
  }

  getFiles(): readonly TFileLike[] {
    return [...this.files.values()].filter((f) => !this.deleted.has(f.path)).map(
      (entry) => {
        const segments = entry.path.split("/");
        return {
          path: entry.path,
          name: segments[segments.length - 1] ?? entry.path,
          stat: { ctime: entry.ctime, mtime: entry.mtime, size: entry.text.length },
        };
      },
    );
  }

  on(
    name: string,
    callback: (...args: unknown[]) => unknown,
  ): unknown {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(callback);
    return { off: () => this.off(name, callback) };
  }

  off(name: string, callback: (...args: unknown[]) => unknown): void {
    this.listeners.get(name)?.delete(callback);
  }

  emit(name: string, ...args: unknown[]): void {
    for (const callback of this.listeners.get(name) ?? []) {
      callback(...args);
    }
  }
}

class MockAdapter implements DataAdapterLike {
  private readonly vault: MockVault;

  constructor(vault: MockVault) {
    this.vault = vault;
  }

  async exists(normalizedPath: string): Promise<boolean> {
    return this.vault.getAbstractFileByPath(normalizedPath) !== null;
  }

  async read(normalizedPath: string): Promise<string> {
    const entry = this.vault.files.get(mockNormalizePath(normalizedPath));
    if (!entry) {
      throw new Error(`ENOENT: ${normalizedPath}`);
    }
    return entry.text;
  }

  async write(normalizedPath: string, data: string): Promise<void> {
    this.vault.putFile(normalizedPath, data);
  }

  async rename(normalizedPath: string, normalizedNewPath: string): Promise<void> {
    const oldPath = mockNormalizePath(normalizedPath);
    const newPath = mockNormalizePath(normalizedNewPath);
    const entry = this.vault.files.get(oldPath);
    if (!entry) {
      throw new Error(`ENOENT: ${oldPath}`);
    }
    this.vault.files.delete(oldPath);
    this.vault.files.set(newPath, { ...entry, path: newPath });
    this.vault.emit("rename", { path: newPath }, oldPath);
  }

  async remove(normalizedPath: string): Promise<void> {
    this.vault.deleteFile(normalizedPath);
  }

  async mkdir(normalizedPath: string): Promise<void> {
    // Mock：目录存在性由 getAbstractFileByPath 查询不到文件来模拟；
    // mkdir 成功后记录目录，供 getAbstractFileByPath 区分。
    this.vault.folders.add(mockNormalizePath(normalizedPath));
  }

  async list(normalizedPath: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = mockNormalizePath(normalizedPath);
    const files: string[] = [];
    const folders: string[] = [];
    for (const path of this.vault.files.keys()) {
      if (path.startsWith(`${prefix}/`)) {
        const rest = path.slice(prefix.length + 1);
        if (!rest.includes("/")) {
          files.push(rest);
        }
      }
    }
    for (const folder of this.vault.folders) {
      if (folder.startsWith(`${prefix}/`)) {
        const rest = folder.slice(prefix.length + 1);
        if (!rest.includes("/")) {
          folders.push(rest);
        }
      }
    }
    return { files, folders };
  }

  async stat(normalizedPath: string): Promise<StatLike | null> {
    const file = this.vault.getAbstractFileByPath(normalizedPath);
    if (file?.stat) {
      return file.stat;
    }
    if (this.vault.folders.has(mockNormalizePath(normalizedPath))) {
      return { ctime: 0, mtime: 0, size: 0 };
    }
    return null;
  }
}

/** 确定性 sha256 hex（测试断言用）。 */
export { sha256HexSync };
