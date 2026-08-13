/**
 * ObsidianRecoveryPort 测试（《文档与会话协议 v1》第 15 章）。
 * MockAdapter 基于 MockVault（config 目录即普通路径）。
 */

import { describe, expect, it } from "vitest";
import type {
  DocumentId,
  RecoveryReasonV1,
  RecoveryRecordV1,
  UtcIsoDateTime,
} from "@ocs/contracts";
import {
  ObsidianRecoveryPort,
  createRecordId,
} from "../../src/platform/obsidian/ObsidianRecoveryPort";
import { MockVault } from "./mock-vault";

const NOW = "2026-08-13T10:20:30.000Z" as UtcIsoDateTime;

function makeRecord(
  overrides: Partial<RecoveryRecordV1> = {},
): RecoveryRecordV1 {
  return {
    kind: "components-studio/recovery",
    recordVersion: 1,
    recordId: "unused",
    vaultId: "vault-1",
    documentId: "doc-1" as DocumentId,
    originPath: "Dashboard/Home.components",
    baseRawHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    createdAt: NOW,
    reason: "close-save-failed" as RecoveryReasonV1,
    documentText: "{\"kind\":\"components-studio/document\"}",
    ...overrides,
  };
}

function makePort(vault: MockVault): ObsidianRecoveryPort {
  return new ObsidianRecoveryPort({
    adapter: vault.adapter,
    configDir: vault.configDir,
    pluginDir: "plugins/components-studio",
    vaultId: "vault-1",
    now: () => NOW,
    uuid: () => "11111111-2222-4333-8444-555555555555",
  });
}

describe("createRecordId", () => {
  it("格式：<UTC basic 时间戳>-<hash 前 16 位>-<UUIDv4 前 8 位>", () => {
    const id = createRecordId("0123456789abcdefFEDCBA9876543210", NOW, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(id).toBe("20260813T102030Z-0123456789abcdef-aaaaaaaa");
  });
});

describe("ObsidianRecoveryPort", () => {
  it("原子写入：临时文件 → 验证 → rename → 目标验证 → 成功，且可列出/读取/删除", async () => {
    const vault = new MockVault();
    const port = makePort(vault);
    const record = makeRecord();

    const written = await port.writeRecovery(record);
    expect(written.ok).toBe(true);
    if (written.ok) {
      expect(written.value.recordId).toBe("20260813T102030Z-bbbbbbbbbbbbbbbb-11111111");
      expect(written.value.documentText).toBe(record.documentText);
    }
    // 无残留临时文件。
    const docDirFiles = await vault.adapter.list(".obsidian/plugins/components-studio/recovery/doc-1");
    expect(docDirFiles.files.every((f) => !f.startsWith("."))).toBe(true);

    const listed = await port.listRecoveries("doc-1" as DocumentId);
    expect(listed.ok && listed.value).toHaveLength(1);

    const read = await port.readRecovery("20260813T102030Z-bbbbbbbbbbbbbbbb-11111111");
    expect(read.ok && read.value.documentId).toBe("doc-1");

    const deleted = await port.deleteRecovery("20260813T102030Z-bbbbbbbbbbbbbbbb-11111111");
    expect(deleted.ok).toBe(true);
    const after = await port.listRecoveries("doc-1" as DocumentId);
    expect(after.ok && after.value).toHaveLength(0);
  });

  it("readRecovery 不存在 → RECOVERY_NOT_FOUND", async () => {
    const port = makePort(new MockVault());
    const result = await port.readRecovery("20260813T102030Z-0123456789abcdef-00000000");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECOVERY_NOT_FOUND");
    }
  });

  it("回读验证失败 → RECOVERY_VERIFY_FAILED（写入不算成功）", async () => {
    const vault = new MockVault();
    const port = makePort(vault);
    // 覆盖 adapter.read：任何读取返回不一致内容。
    const originalRead = vault.adapter.read.bind(vault.adapter);
    vault.adapter.read = async () => "tampered";
    const written = await port.writeRecovery(makeRecord());
    expect(written.ok).toBe(false);
    if (!written.ok) {
      expect(written.error.code).toBe("RECOVERY_VERIFY_FAILED");
    }
    // 恢复真实 read；目标文件不应被写成成功记录（temp 已清理）。
    vault.adapter.read = originalRead;
    const listed = await port.listRecoveries("doc-1" as DocumentId);
    expect(listed.ok && listed.value).toHaveLength(0);
  });
});
