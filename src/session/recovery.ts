/**
 * RecoveryPortV1 目录适配器（《文档与会话协议 v1》第 15.3 节）。
 *
 * 保持文件系统无关：通过注入的 `RecoveryFileSystem` 原语（writeFile/readFile/
 * rename/list/remove）访问目录，测试可用内存实现。写入协议：
 * 临时文件 → 回读验证结构 → 原子 Rename → 再回读验证 → 成功。
 * 保留策略（15.4）：每文档最近 20 份，从最旧开始清理；清理失败只记录、不阻塞。
 */

import type {
  MigrationBackupRecordV1,
  ProtocolError,
  RecoveryPortV1,
  RecoveryRecordV1,
  Result,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";

export interface RecoveryFileSystem {
  writeFile(path: string, text: string): Promise<Result<void>>;
  readFile(path: string): Promise<Result<string>>;
  rename(from: string, to: string): Promise<Result<void>>;
  /** 返回目录内文件名列表（不含子目录）。 */
  list(dir: string): Promise<Result<readonly string[]>>;
  remove(path: string): Promise<Result<void>>;
}

export const RECOVERY_RETAIN_PER_DOCUMENT = 20;

function fail(code: string, message: string): { ok: false; error: ProtocolError } {
  return {
    ok: false,
    error: {
      code: code as ProtocolError["code"],
      message,
      scope: "recovery",
      recoverable: true,
      retryable: true,
    },
  };
}

function okRecord<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export class DirectoryRecoveryPort implements RecoveryPortV1 {
  constructor(
    private readonly fs: RecoveryFileSystem,
    private readonly baseDir: string,
  ) {}

  async writeRecovery(record: RecoveryRecordV1): Promise<Result<RecoveryRecordV1>> {
    const dir = `${this.baseDir}/recovery/${record.documentId}`;
    const target = `${dir}/${record.recordId}.json`;
    const tmp = `${dir}/.tmp-${record.recordId}.json`;
    const text = JSON.stringify(record, null, 2);

    const created = await this.fs.writeFile(tmp, text);
    if (!created.ok) return fail(ERROR_CODES.RECOVERY_WRITE_FAILED, `写入临时文件失败: ${tmp}`);
    const verifiedTmp = await this.verifyFile<RecoveryRecordV1>(tmp);
    if (!verifiedTmp.ok || !isRecoveryRecord(verifiedTmp.value, record.recordId)) {
      return fail(ERROR_CODES.RECOVERY_VERIFY_FAILED, "临时文件回读验证失败");
    }
    const renamed = await this.fs.rename(tmp, target);
    if (!renamed.ok) return fail(ERROR_CODES.RECOVERY_WRITE_FAILED, `Rename 失败: ${target}`);
    const verified = await this.verifyFile<RecoveryRecordV1>(target);
    if (!verified.ok || !isRecoveryRecord(verified.value, record.recordId)) {
      return fail(ERROR_CODES.RECOVERY_VERIFY_FAILED, "目标文件回读验证失败");
    }
    await this.enforceRetention(dir, RECOVERY_RETAIN_PER_DOCUMENT);
    return okRecord(record);
  }

  async writeMigrationBackup(record: MigrationBackupRecordV1): Promise<Result<MigrationBackupRecordV1>> {
    const dir = `${this.baseDir}/migration-backups/${record.documentId ?? "unknown"}`;
    const target = `${dir}/${record.recordId}.json`;
    const tmp = `${dir}/.tmp-${record.recordId}.json`;
    const text = JSON.stringify(record, null, 2);

    const created = await this.fs.writeFile(tmp, text);
    if (!created.ok) return fail(ERROR_CODES.RECOVERY_WRITE_FAILED, `写入临时文件失败: ${tmp}`);
    const verifiedTmp = await this.verifyFile<MigrationBackupRecordV1>(tmp);
    if (!verifiedTmp.ok || !isBackupRecord(verifiedTmp.value, record.recordId)) {
      return fail(ERROR_CODES.RECOVERY_VERIFY_FAILED, "临时文件回读验证失败");
    }
    const renamed = await this.fs.rename(tmp, target);
    if (!renamed.ok) return fail(ERROR_CODES.RECOVERY_WRITE_FAILED, `Rename 失败: ${target}`);
    const verified = await this.verifyFile<MigrationBackupRecordV1>(target);
    if (!verified.ok || !isBackupRecord(verified.value, record.recordId)) {
      return fail(ERROR_CODES.RECOVERY_VERIFY_FAILED, "目标文件回读验证失败");
    }
    await this.enforceRetention(dir, 10);
    return okRecord(record);
  }

  async listRecoveries(documentId?: string): Promise<Result<readonly RecoveryRecordV1[]>> {
    const dir = documentId
      ? `${this.baseDir}/recovery/${documentId}`
      : `${this.baseDir}/recovery`;
    const listed = await this.fs.list(dir);
    if (!listed.ok) {
      // 目录不存在视为空列表
      return okRecord([] as readonly RecoveryRecordV1[]);
    }
    const out: RecoveryRecordV1[] = [];
    for (const name of listed.value) {
      if (!name.endsWith(".json")) continue;
      const read = await this.verifyFile<RecoveryRecordV1>(`${dir}/${name}`);
      if (read.ok && isRecoveryRecord(read.value, name.slice(0, -5))) {
        out.push(read.value);
      }
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return okRecord(out);
  }

  async readRecovery(recordId: string): Promise<Result<RecoveryRecordV1>> {
    const dirs = await this.fs.list(`${this.baseDir}/recovery`);
    if (!dirs.ok) return fail(ERROR_CODES.RECOVERY_NOT_FOUND, "恢复目录不存在");
    for (const docDir of dirs.value) {
      const read = await this.verifyFile<RecoveryRecordV1>(`${this.baseDir}/recovery/${docDir}/${recordId}.json`);
      if (read.ok) return read;
    }
    return fail(ERROR_CODES.RECOVERY_NOT_FOUND, `未找到恢复记录: ${recordId}`);
  }

  async deleteRecovery(recordId: string): Promise<Result<void>> {
    const dirs = await this.fs.list(`${this.baseDir}/recovery`);
    if (!dirs.ok) return fail(ERROR_CODES.RECOVERY_DELETE_FAILED, "恢复目录不存在");
    for (const docDir of dirs.value) {
      const removed = await this.fs.remove(`${this.baseDir}/recovery/${docDir}/${recordId}.json`);
      if (removed.ok) return okRecord(undefined);
    }
    return fail(ERROR_CODES.RECOVERY_NOT_FOUND, `未找到恢复记录: ${recordId}`);
  }

  private async verifyFile<T>(path: string): Promise<Result<T>> {
    const read = await this.fs.readFile(path);
    if (!read.ok) return fail(ERROR_CODES.RECOVERY_READ_FAILED, `读取失败: ${path}`);
    try {
      return okRecord(JSON.parse(read.value) as T);
    } catch {
      return fail(ERROR_CODES.RECOVERY_VERIFY_FAILED, `JSON 解析失败: ${path}`);
    }
  }

  /** 只在新记录验证成功后执行；从最旧清理，至少保留最新一份；失败不影响记录。 */
  private async enforceRetention(dir: string, maxPerDocument: number): Promise<void> {
    const listed = await this.fs.list(dir);
    if (!listed.ok) return;
    const names = listed.value.filter((n) => n.endsWith(".json")).sort();
    if (names.length <= maxPerDocument) return;
    const toRemove = names.slice(0, names.length - maxPerDocument);
    for (const name of toRemove) {
      await this.fs.remove(`${dir}/${name}`);
    }
  }
}

function isRecoveryRecord(value: unknown, recordId: string): value is RecoveryRecordV1 {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "components-studio/recovery" &&
    v.recordVersion === 1 &&
    v.recordId === recordId &&
    typeof v.vaultId === "string" &&
    typeof v.documentId === "string" &&
    typeof v.originPath === "string" &&
    typeof v.contentHash === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.reason === "string" &&
    typeof v.documentText === "string"
  );
}

function isBackupRecord(value: unknown, recordId: string): value is MigrationBackupRecordV1 {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "components-studio/migration-backup" &&
    v.recordVersion === 1 &&
    v.recordId === recordId &&
    typeof v.originPath === "string" &&
    typeof v.sourceRawHash === "string" &&
    typeof v.sourceFormat === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.originalText === "string"
  );
}
