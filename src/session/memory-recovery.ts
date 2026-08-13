/**
 * 内存 RecoveryPortV1（测试/开发用）。
 * 与 DirectoryRecoveryPort 同语义：写入即验证结构、按 createdAt 保留每文档最近 20 份。
 */

import type {
  MigrationBackupRecordV1,
  ProtocolError,
  RecoveryPortV1,
  RecoveryRecordV1,
  Result,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";

const RETAIN = 20;

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

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** 按 documentId 保留最近 RETAIN 份（从最旧开始清理）。 */
function retainByDocumentId(
  map: Map<string, { readonly documentId: string | null; readonly createdAt: string }>,
  documentId: string | null,
): void {
  const entries = [...map.entries()].filter(([, v]) => v.documentId === documentId);
  if (entries.length <= RETAIN) return;
  entries.sort((a, b) => (a[1].createdAt < b[1].createdAt ? -1 : a[1].createdAt > b[1].createdAt ? 1 : 0));
  const toDrop = entries.slice(0, entries.length - RETAIN);
  for (const [id] of toDrop) map.delete(id);
}

export class MemoryRecoveryPort implements RecoveryPortV1 {
  private readonly recoveries = new Map<string, RecoveryRecordV1>();
  private readonly backups = new Map<string, MigrationBackupRecordV1>();

  async writeRecovery(record: RecoveryRecordV1): Promise<Result<RecoveryRecordV1>> {
    if (!isRecoveryRecord(record)) return fail(ERROR_CODES.RECOVERY_VERIFY_FAILED, "恢复记录结构非法");
    this.recoveries.set(record.recordId, { ...record });
    retainByDocumentId(this.recoveries, record.documentId);
    return ok(record);
  }

  async writeMigrationBackup(record: MigrationBackupRecordV1): Promise<Result<MigrationBackupRecordV1>> {
    if (!isBackupRecord(record)) return fail(ERROR_CODES.RECOVERY_VERIFY_FAILED, "迁移备份记录结构非法");
    this.backups.set(record.recordId, { ...record });
    retainByDocumentId(this.backups, record.documentId);
    return ok(record);
  }

  async listRecoveries(documentId?: string): Promise<Result<readonly RecoveryRecordV1[]>> {
    const all = [...this.recoveries.values()].filter(
      (r) => documentId === undefined || r.documentId === documentId,
    );
    all.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return ok(all);
  }

  async readRecovery(recordId: string): Promise<Result<RecoveryRecordV1>> {
    const record = this.recoveries.get(recordId);
    if (!record) return fail(ERROR_CODES.RECOVERY_NOT_FOUND, `未找到恢复记录: ${recordId}`);
    return ok(record);
  }

  async deleteRecovery(recordId: string): Promise<Result<void>> {
    if (!this.recoveries.delete(recordId)) {
      return fail(ERROR_CODES.RECOVERY_NOT_FOUND, `未找到恢复记录: ${recordId}`);
    }
    return ok(undefined);
  }

  // 测试辅助
  getRecovery(recordId: string): RecoveryRecordV1 | null {
    return this.recoveries.get(recordId) ?? null;
  }

  recoveryCount(): number {
    return this.recoveries.size;
  }

  listRecoveryIds(): string[] {
    return [...this.recoveries.keys()];
  }
}

function isRecoveryRecord(value: unknown): value is RecoveryRecordV1 {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "components-studio/recovery" &&
    v.recordVersion === 1 &&
    typeof v.recordId === "string" &&
    typeof v.vaultId === "string" &&
    typeof v.documentId === "string" &&
    typeof v.originPath === "string" &&
    typeof v.contentHash === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.reason === "string" &&
    typeof v.documentText === "string"
  );
}

function isBackupRecord(value: unknown): value is MigrationBackupRecordV1 {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "components-studio/migration-backup" &&
    v.recordVersion === 1 &&
    typeof v.recordId === "string" &&
    typeof v.originPath === "string" &&
    typeof v.sourceRawHash === "string" &&
    typeof v.sourceFormat === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.originalText === "string"
  );
}
