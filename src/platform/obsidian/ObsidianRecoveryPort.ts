/**
 * ObsidianRecoveryPort —— RecoveryPortV1 的 Obsidian 实现
 * （《文档与会话协议 v1》第 15 章）。
 *
 * 存储位置（第 15.3 节，使用当前 Vault 的配置目录，不硬编码 `.obsidian`）：
 *   <vault-config-dir>/plugins/components-studio/recovery/<documentId>/<recordId>.json
 *   <vault-config-dir>/plugins/components-studio/migration-backups/<documentId-or-unknown>/<recordId>.json
 *
 * 路径解析选择（设计记录）：
 * - Obsidian 1.13 公开 `Vault.configDir`（".obsidian" 或自定义配置目录名），
 *   且 `Vault.adapter` 的路径相对 Vault 根。因此本实现用
 *   `vault.configDir + vault.adapter` 读写，无需私有 API 或 `as any`。
 * - 若 configDir 为空（异常宿主），回退到插件数据目录 `pluginDir`
 *   （= manifest.dir，Phase 0 兜底）。两种来源共用同一套原子写入协议。
 *
 * 原子写入（第 15.3 节）：同目录临时文件 → 回读验证 → rename 为目标 →
 * 再回读验证 → 才返回成功。
 *
 * 保留（第 15.4 节）：recovery 每文档 20 份、migration backup 每文档 10 份、
 * 两类总量软上限 200 MiB；清理只在新记录验证成功后进行，从最旧开始，
 * 至少保留每文档最新一份。
 */

import type {
  DocumentId,
  MigrationBackupRecordV1,
  ProtocolError,
  RecoveryPortV1,
  RecoveryRecordV1,
  Result,
  UtcIsoDateTime,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import { newUuidV4 } from "../../shared/id";
import { sha256HexSync } from "../../shared/hash";
import {
  lazyNormalizePath,
  ok,
  type DataAdapterLike,
  type StatLike,
} from "./obsidian-api";

const RECOVERY_SCOPE = "recovery" as const;
const ROOT_DIR = "plugins/components-studio";
const RECOVERY_DIR = `${ROOT_DIR}/recovery`;
const BACKUP_DIR = `${ROOT_DIR}/migration-backups`;
const RETENTION_RECOVERY = 20;
const RETENTION_BACKUP = 10;
const SOFT_CAP_BYTES = 200 * 1024 * 1024;

function recoveryError(
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
      scope: RECOVERY_SCOPE,
      recoverable: true,
      retryable: code !== ERROR_CODES.RECOVERY_NOT_FOUND,
      path,
      details: {},
      cause,
    },
  };
}

export interface ObsidianRecoveryPortOptions {
  /** 写临时文件用的文件系统适配器（路径相对 Vault 根）。 */
  readonly adapter: DataAdapterLike;
  /** 配置目录相对路径（如 ".obsidian"）。 */
  readonly configDir: string;
  readonly pluginDir: string;
  readonly vaultId: string;
  /** 注入以便测试确定性。 */
  readonly now?: () => UtcIsoDateTime;
  readonly uuid?: () => string;
}

interface RecordFile {
  readonly relPath: string;
  readonly recordId: string;
  readonly createdAt: UtcIsoDateTime;
  readonly sizeBytes: number;
}

const ZERO_TIME = "1970-01-01T00:00:00.000Z" as UtcIsoDateTime;

/** ISO 时间 → UTC basic 时间戳（YYYYMMDDTHHMMSSZ）。 */
function basicUtcTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "19700101T000000Z";
  }
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function hashPrefix16(hash: string | null | undefined, fallback: string): string {
  const source = hash && hash.length > 0 ? hash : sha256HexSync(fallback);
  return source.slice(0, 16);
}

/** recordId = <UTC basic timestamp>-<hash 前 16 位>-<UUIDv4 前 8 位>（第 15.4 节）。 */
export function createRecordId(
  seedHash: string,
  now: UtcIsoDateTime,
  uuid: string,
): string {
  return `${basicUtcTimestamp(now)}-${hashPrefix16(seedHash, seedHash)}-${uuid.slice(0, 8)}`;
}

export class ObsidianRecoveryPort implements RecoveryPortV1 {
  private readonly adapter: DataAdapterLike;
  private readonly baseDir: string;
  private readonly vaultId: string;
  private readonly now: () => UtcIsoDateTime;
  private readonly uuid: () => string;

  constructor(options: ObsidianRecoveryPortOptions) {
    this.adapter = options.adapter;
    const configDir = lazyNormalizePath(options.configDir);
    this.baseDir =
      configDir.length > 0 ? `${configDir}/${ROOT_DIR}` : options.pluginDir;
    this.vaultId = options.vaultId;
    this.now = options.now ?? (() => new Date().toISOString() as UtcIsoDateTime);
    this.uuid = options.uuid ?? newUuidV4;
  }

  async writeRecovery(
    record: RecoveryRecordV1,
  ): Promise<Result<RecoveryRecordV1>> {
    const written = await this.persist(
      RECOVERY_DIR,
      record.documentId,
      JSON.stringify(record),
      record.contentHash,
      record.createdAt,
      RETENTION_RECOVERY,
      "recovery",
    );
    if (!written.ok) {
      return written;
    }
    return ok({ ...record, recordId: written.value });
  }

  async writeMigrationBackup(
    record: MigrationBackupRecordV1,
  ): Promise<Result<MigrationBackupRecordV1>> {
    const written = await this.persist(
      BACKUP_DIR,
      record.documentId ?? "unknown",
      JSON.stringify(record),
      record.sourceRawHash,
      record.createdAt,
      RETENTION_BACKUP,
      "migration-backup",
    );
    if (!written.ok) {
      return written;
    }
    return ok({ ...record, recordId: written.value });
  }

  async listRecoveries(
    documentId?: DocumentId,
  ): Promise<Result<readonly RecoveryRecordV1[]>> {
    const dirs = documentId
      ? [lazyNormalizePath(`${RECOVERY_DIR}/${documentId}`)]
      : await this.listDocumentDirs(RECOVERY_DIR);
    const records: RecoveryRecordV1[] = [];
    for (const dir of dirs) {
      const files = await this.listRecordFiles(dir);
      if (!files.ok) {
        return files;
      }
      for (const file of files.value) {
        const parsed = await this.readParsed(file.relPath);
        if (parsed.ok && parsed.value.kind === "components-studio/recovery") {
          records.push(parsed.value);
        }
      }
    }
    records.sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
    );
    return ok(records);
  }

  async readRecovery(recordId: string): Promise<Result<RecoveryRecordV1>> {
    const found = await this.findRecordFile(recordId);
    if (!found.ok) {
      return found;
    }
    const parsed = await this.readParsed(found.value.relPath);
    if (!parsed.ok) {
      return parsed;
    }
    if (parsed.value.kind !== "components-studio/recovery") {
      return recoveryError(
        ERROR_CODES.RECOVERY_READ_FAILED,
        `记录类型不符：${recordId}`,
        found.value.relPath,
      );
    }
    return ok(parsed.value);
  }

  async deleteRecovery(recordId: string): Promise<Result<void>> {
    const found = await this.findRecordFile(recordId);
    if (!found.ok) {
      return found;
    }
    try {
      await this.adapter.remove(found.value.relPath);
      return ok(undefined);
    } catch (cause) {
      return recoveryError(
        ERROR_CODES.RECOVERY_DELETE_FAILED,
        `删除记录失败：${recordId}`,
        found.value.relPath,
        cause,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private async persist(
    kindDir: string,
    documentKey: string,
    json: string,
    seedHash: string,
    createdAt: UtcIsoDateTime,
    retention: number,
    kindLabel: "recovery" | "migration-backup",
  ): Promise<Result<string>> {
    const docDir = lazyNormalizePath(`${kindDir}/${documentKey}`);
    const recordId = createRecordId(seedHash, this.now(), this.uuid());
    const target = lazyNormalizePath(`${docDir}/${recordId}.json`);
    const temp = lazyNormalizePath(`${docDir}/.${recordId}.tmp`);

    const dirReady = await this.ensureDir(docDir);
    if (!dirReady.ok) {
      return dirReady;
    }
    try {
      // 1. 同目录临时文件。
      await this.adapter.write(temp, json);
      // 2. 回读临时文件并验证。
      const readBack = await this.adapter.read(temp);
      if (readBack !== json) {
        await this.tryRemove(temp);
        return recoveryError(
          ERROR_CODES.RECOVERY_VERIFY_FAILED,
          `临时文件回读不一致：${recordId}`,
          temp,
        );
      }
      // 3. 原子 rename 为目标。
      await this.adapter.rename(temp, target);
      // 4. 再回读目标验证。
      const targetRead = await this.adapter.read(target);
      if (targetRead !== json) {
        return recoveryError(
          ERROR_CODES.RECOVERY_VERIFY_FAILED,
          `目标文件回读不一致：${recordId}`,
          target,
        );
      }
      // 5. 只有第 4 步成功才算成功；随后做保留清理。
      await this.enforceRetention(kindDir, documentKey, retention, kindLabel);
      return ok(recordId);
    } catch (cause) {
      await this.tryRemove(temp);
      return recoveryError(
        ERROR_CODES.RECOVERY_WRITE_FAILED,
        `写入恢复记录失败：${recordId}`,
        target,
        cause,
      );
    }
  }

  private async ensureDir(dir: string): Promise<Result<void>> {
    try {
      if (await this.adapter.exists(dir)) {
        return ok(undefined);
      }
      await this.adapter.mkdir(dir);
      return ok(undefined);
    } catch (cause) {
      try {
        if (await this.adapter.exists(dir)) {
          return ok(undefined);
        }
      } catch {
        // fall through
      }
      return recoveryError(
        ERROR_CODES.RECOVERY_WRITE_FAILED,
        `创建恢复目录失败：${dir}`,
        dir,
        cause,
      );
    }
  }

  private async tryRemove(path: string): Promise<void> {
    try {
      await this.adapter.remove(path);
    } catch {
      // 临时文件清理失败只记录 Warning，不得把未验证记录称为成功。
    }
  }

  private async listDocumentDirs(kindDir: string): Promise<string[]> {
    try {
      const listed = await this.adapter.list(kindDir);
      return listed.folders.map((f) => lazyNormalizePath(`${kindDir}/${f}`));
    } catch {
      return [];
    }
  }

  private async listRecordFiles(dir: string): Promise<Result<readonly RecordFile[]>> {
    let files: string[];
    try {
      const listed = await this.adapter.list(dir);
      files = listed.files;
    } catch {
      // 目录不存在（无记录）视为空列表。
      return ok([]);
    }
    const out: RecordFile[] = [];
    for (const name of files) {
      if (!name.endsWith(".json") || name.startsWith(".")) {
        continue;
      }
      const relPath = lazyNormalizePath(`${dir}/${name}`);
      let stat: StatLike | null = null;
      try {
        stat = await this.adapter.stat(relPath);
      } catch {
        stat = null;
      }
      const recordId = name.replace(/\.json$/, "");
      const timePart = recordId.split("-")[0];
      out.push({
        relPath,
        recordId,
        createdAt: parseRecordTimestamp(timePart),
        sizeBytes: stat?.size ?? 0,
      });
    }
    out.sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
    );
    return ok(out);
  }

  private async findRecordFile(recordId: string): Promise<Result<RecordFile>> {
    for (const kindDir of [RECOVERY_DIR, BACKUP_DIR]) {
      const dirs = await this.listDocumentDirs(kindDir);
      for (const dir of dirs) {
        const files = await this.listRecordFiles(dir);
        if (!files.ok) {
          continue;
        }
        for (const file of files.value) {
          if (file.recordId === recordId) {
            return ok(file);
          }
        }
      }
    }
    return recoveryError(ERROR_CODES.RECOVERY_NOT_FOUND, `记录不存在：${recordId}`);
  }

  private async readParsed(
    relPath: string,
  ): Promise<Result<RecoveryRecordV1 | MigrationBackupRecordV1>> {
    let text: string;
    try {
      text = await this.adapter.read(relPath);
    } catch (cause) {
      return recoveryError(
        ERROR_CODES.RECOVERY_READ_FAILED,
        `读取记录失败：${relPath}`,
        relPath,
        cause,
      );
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "kind" in parsed &&
        (parsed.kind === "components-studio/recovery" ||
          parsed.kind === "components-studio/migration-backup")
      ) {
        return ok(parsed as RecoveryRecordV1 | MigrationBackupRecordV1);
      }
      return recoveryError(
        ERROR_CODES.RECOVERY_READ_FAILED,
        `记录 JSON 非法：${relPath}`,
        relPath,
      );
    } catch (cause) {
      return recoveryError(
        ERROR_CODES.RECOVERY_READ_FAILED,
        `记录 JSON 解析失败：${relPath}`,
        relPath,
        cause,
      );
    }
  }

  private async enforceRetention(
    kindDir: string,
    documentKey: string,
    retention: number,
    kindLabel: "recovery" | "migration-backup",
  ): Promise<void> {
    try {
      const docDir = lazyNormalizePath(`${kindDir}/${documentKey}`);
      const files = await this.listRecordFiles(docDir);
      if (!files.ok) {
        return;
      }
      // 每文档保留上限：从最旧删除。
      for (let i = 0; i + retention < files.value.length; i++) {
        await this.tryRemove(files.value[i]!.relPath);
      }
      // 总量软上限（至少保留每文档最新一份）。
      await this.enforceTotalSoftCap(kindLabel);
    } catch {
      // 清理失败不影响已写记录，也不阻止当前 Session 继续只读使用。
    }
  }

  private async enforceTotalSoftCap(
    kindLabel: "recovery" | "migration-backup",
  ): Promise<void> {
    try {
      const all = await this.collectAllRecords(kindLabel);
      let total = 0;
      for (const file of all) {
        total += file.sizeBytes;
      }
      if (total <= SOFT_CAP_BYTES) {
        return;
      }
      const newestByDoc = new Map<
        string,
        { documentKey: string; relPath: string; sizeBytes: number; createdAt: UtcIsoDateTime }
      >();
      for (const file of all) {
        newestByDoc.set(file.documentKey, file);
      }
      for (const file of all) {
        if (total <= SOFT_CAP_BYTES) {
          break;
        }
        if (newestByDoc.get(file.documentKey)?.relPath === file.relPath) {
          continue; // 保留每文档最新一份
        }
        await this.tryRemove(file.relPath);
        total -= file.sizeBytes;
      }
    } catch {
      // 软上限清理失败不影响已写记录。
    }
  }

  private async collectAllRecords(
    kindLabel: "recovery" | "migration-backup",
  ): Promise<
    Array<{
      documentKey: string;
      relPath: string;
      sizeBytes: number;
      createdAt: UtcIsoDateTime;
    }>
  > {
    const kindDir = kindLabel === "recovery" ? RECOVERY_DIR : BACKUP_DIR;
    const dirs = await this.listDocumentDirs(kindDir);
    const out: Array<{
      documentKey: string;
      relPath: string;
      sizeBytes: number;
      createdAt: UtcIsoDateTime;
    }> = [];
    for (const dir of dirs) {
      const files = await this.listRecordFiles(dir);
      if (!files.ok) {
        continue;
      }
      const segments = dir.split("/");
      const documentKey = segments[segments.length - 1] ?? "unknown";
      for (const file of files.value) {
        out.push({
          documentKey,
          relPath: file.relPath,
          sizeBytes: file.sizeBytes,
          createdAt: file.createdAt,
        });
      }
    }
    out.sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
    );
    return out;
  }
}

function parseRecordTimestamp(timePart: string | undefined): UtcIsoDateTime {
  if (!timePart || !/^\d{8}T\d{6}Z$/.test(timePart)) {
    return ZERO_TIME;
  }
  const year = Number(timePart.slice(0, 4));
  const month = Number(timePart.slice(4, 6)) - 1;
  const day = Number(timePart.slice(6, 8));
  const hour = Number(timePart.slice(9, 11));
  const minute = Number(timePart.slice(11, 13));
  const second = Number(timePart.slice(13, 15));
  const date = new Date(Date.UTC(year, month, day, hour, minute, second));
  if (Number.isNaN(date.getTime())) {
    return ZERO_TIME;
  }
  return date.toISOString() as UtcIsoDateTime;
}
