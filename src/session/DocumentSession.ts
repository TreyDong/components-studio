/**
 * DocumentSession（《文档与会话协议 v1》第 10–16 章）。
 *
 * 状态（12.1）：baseDocument / workingDocument / baseText / baseRawHash /
 * baseSemanticHash / baseContentHash / savedContentHash / sessionVersion /
 * inFlightSave / saveRequestedAgain / expectedOwnWriteHash / pendingExternal。
 *
 * 关键不变量：
 * - getSnapshot() 深只读；sessionVersion 未变时引用稳定，变化后换新引用
 *   （12.3.17 的 Rebase 例外：换新引用但不加版本）。
 * - Dirty 只由 workingContentHash !== savedContentHash 判定。
 * - 单 In-flight Save；并发 save() 置 saveRequestedAgain。
 * - 外部事件与 Save 完成回调经单线程队列按序处理；Dispose 后一律忽略。
 */

import type {
  CasTextResultV1,
  CommandResultV1,
  ComponentsDocumentV1,
  ConflictResolutionV1,
  ConflictId,
  DeepReadonly,
  DiagnosticV1,
  DirtyReasonV1,
  DocumentId,
  DocumentSessionV1,
  FileSnapshotV1,
  JsonObject,
  ParsedDocumentV1,
  PendingConflictV1,
  ProtocolError,
  Result,
  RuntimeErrorV1,
  SaveResultV1,
  SessionStatusV1,
  StorageEventV1,
  TransactionOptionsV1,
  UtcIsoDateTime,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import type {
  ClockPort,
  ComponentsStoragePort,
} from "../platform/ports";
import { DocumentCodec } from "../document/codec";
import { applyCommands } from "../document/reducer";
import type { CodecRegistry } from "../document/types";
import { deepFreeze } from "../document/validate";
import { newUuidV4 } from "../shared/id";
import { sha256HexSync } from "../shared/hash";
import { HistoryStack } from "./history";
import type { HistoryEntry } from "./history";
import { threeWayMerge } from "./merge";

const AUTOSAVE_DEBOUNCE_MS = 750;
const AUTOSAVE_MAX_DELAY_MS = 5_000;
const AUTOSAVE_BACKOFF_MAX_MS = 30_000;
const OWN_WRITE_HASH_CAP = 128;

export interface DocumentSessionOptions {
  readonly path: string;
  readonly codec: DocumentCodec;
  readonly storage: ComponentsStoragePort;
  readonly recovery: import("@ocs/contracts").RecoveryPortV1;
  readonly clock: ClockPort;
  readonly vaultId: string;
  readonly nowMs: number;
  /** 已成功解析的初始文档（acquire 已 parse）。 */
  readonly parsed: ParsedDocumentV1;
  /** 初始磁盘/视图快照。 */
  readonly snapshot: FileSnapshotV1;
  /** Rename 时由 SessionManager 原子更新缓存 Key。 */
  readonly onRename: (oldPath: string, newPath: string) => void;
  /** Dispose 完成回调（工厂驱逐缓存条目）。 */
  readonly onDisposed: (path: string) => void;
  /** 可选的路径→DocumentId 快速身份检查（Rename 双文件存在时）。 */
  readonly documentIdOf?: (path: string) => DocumentId | null;
}

export function utcIso(ms: number): UtcIsoDateTime {
  const d = new Date(ms);
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}Z` as UtcIsoDateTime;
}

function basicUtc(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** recordId（15.4）：<UTC basic timestamp>-<hash 前 16 位>-<UUIDv4 前 8 位>。 */
export function buildRecordId(nowMs: number, hash: string): string {
  return `${basicUtc(nowMs)}-${hash.slice(0, 16)}-${newUuidV4().slice(0, 8)}`;
}

export function sessionError(
  code: ProtocolError["code"],
  message: string,
  opts: {
    readonly scope?: ProtocolError["scope"];
    readonly recoverable?: boolean;
    readonly retryable?: boolean;
    readonly path?: string;
    readonly componentId?: import("@ocs/contracts").ComponentId;
    readonly details?: JsonObject;
  } = {},
): ProtocolError {
  return {
    code,
    message,
    scope: opts.scope ?? "session",
    recoverable: opts.recoverable ?? true,
    retryable: opts.retryable ?? false,
    path: opts.path,
    componentId: opts.componentId,
    details: opts.details,
  };
}

/** ProtocolError → RuntimeErrorV1（状态机错误字段要求完整 pointer/componentId）。 */
export function toRuntimeError(error: ProtocolError): RuntimeErrorV1 {
  return {
    code: error.code,
    message: error.message,
    scope: error.scope as RuntimeErrorV1["scope"],
    recoverable: error.recoverable,
    retryable: error.retryable,
    pointer: null,
    componentId: error.componentId ?? null,
    details: error.details ?? {},
  };
}

function err(code: ProtocolError["code"], message: string): { ok: false; error: ProtocolError } {
  return { ok: false, error: sessionError(code, message) };
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** DocumentCodec 内部持有的 CodecRegistry（TS private 仅编译期）。 */
export function registryOf(codec: DocumentCodec): CodecRegistry {
  return (codec as unknown as { readonly registry: CodecRegistry }).registry;
}

interface _SessionState {
  readonly document: DeepReadonly<ComponentsDocumentV1>;
  readonly contentHash: string;
  readonly sessionVersion: number;
}

export class DocumentSession implements DocumentSessionV1 {
  readonly documentId: DocumentId;

  private readonly codec: DocumentCodec;
  private readonly storage: ComponentsStoragePort;
  private readonly recovery: import("@ocs/contracts").RecoveryPortV1;
  private readonly clock: ClockPort;
  private readonly vaultId: string;
  private readonly onRename: (oldPath: string, newPath: string) => void;
  private readonly onDisposed: (path: string) => void;
  private readonly documentIdOf: ((path: string) => DocumentId | null) | undefined;
  private readonly registry: CodecRegistry;

  private path: string;
  private baseDocument: DeepReadonly<ComponentsDocumentV1>;
  private workingDocument: DeepReadonly<ComponentsDocumentV1>;
  private snapshotRef: DeepReadonly<ComponentsDocumentV1>;
  private baseText: string;
  private baseRawHash: string;
  private baseSemanticHash: string;
  private baseContentHash: string;
  private savedContentHash: string;
  private sessionVersion = 0;
  private status: SessionStatusV1;
  private reasons: DirtyReasonV1[] = [];
  private readonly usedCommandIds = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly history = new HistoryStack();
  private blockHistoryMerge = false;
  private lastDiskSnapshot: FileSnapshotV1;
  private readonly expectedOwnWriteHash = new Set<string>();
  private pendingConflict: PendingConflictV1 | null = null;
  private inFlightSave: Promise<Result<SaveResultV1>> | null = null;
  private saveRequestedAgain = false;
  private disposed = false;
  private autosaveTimer: import("@ocs/contracts").Disposable | null = null;
  private firstDirtyAtMs: number | null = null;
  private consecutiveSaveFailures = 0;
  private storageUnsubscribe: (() => void) | null = null;
  private eventChain: Promise<void> = Promise.resolve();

  constructor(options: DocumentSessionOptions) {
    this.path = options.path;
    this.codec = options.codec;
    this.storage = options.storage;
    this.recovery = options.recovery;
    this.clock = options.clock;
    this.vaultId = options.vaultId;
    this.onRename = options.onRename;
    this.onDisposed = options.onDisposed;
    this.documentIdOf = options.documentIdOf;
    this.registry = registryOf(options.codec);

    const doc = options.parsed.document;
    this.documentId = doc.documentId;
    this.baseDocument = doc;
    this.workingDocument = doc;
    this.snapshotRef = doc;
    this.baseText = options.snapshot.text;
    this.baseRawHash = options.snapshot.rawHash;
    this.baseSemanticHash = options.parsed.semanticHash;
    this.baseContentHash = options.parsed.contentHash;
    this.savedContentHash = options.parsed.contentHash;
    this.lastDiskSnapshot = options.snapshot;
    this.status = { kind: "ready", dirty: false, reasons: [] };

    this.storageUnsubscribe = this.storage.subscribe(this.path, (event) => {
      this.enqueueExternalEvent(event);
    });
  }

  // -------------------------------------------------------------------------
  // DocumentSessionV1
  // -------------------------------------------------------------------------

  getPath(): string {
    return this.path;
  }

  getStatus(): SessionStatusV1 {
    return this.status;
  }

  getSnapshot(): DeepReadonly<ComponentsDocumentV1> {
    return this.snapshotRef;
  }

  getSessionVersion(): number {
    return this.sessionVersion;
  }

  getContentHash(): string {
    return this.workingContentHash();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispatch(
    commands: import("@ocs/contracts/document").DocumentCommandV1 | readonly import("@ocs/contracts/document").DocumentCommandV1[],
    options: TransactionOptionsV1,
  ): Result<CommandResultV1> {
    if (this.disposed) return err(ERROR_CODES.CMD_SESSION_DISPOSED, "Session 已释放");
    if (!this.isEditable()) {
      return err(ERROR_CODES.CMD_SESSION_NOT_EDITABLE, `当前状态不允许编辑: ${this.status.kind}`);
    }
    if (options.expectedSessionVersion !== this.sessionVersion) {
      return err(ERROR_CODES.CMD_STALE_SESSION_VERSION, `期望版本 ${options.expectedSessionVersion}，当前 ${this.sessionVersion}`);
    }
    const labelLen = Array.from(options.label ?? "").length;
    if (labelLen < 1 || labelLen > 120) {
      return err(ERROR_CODES.TX_VALIDATION_FAILED, "label 必须为 1～120 个 code point");
    }
    const list = Array.isArray(commands) ? commands : [commands];
    for (const command of list) {
      if (this.usedCommandIds.has(command.commandId)) {
        return err(ERROR_CODES.CMD_DUPLICATE_ID, `CommandId 已执行过: ${command.commandId}`);
      }
    }

    // 隔离 Draft 上执行；失败丢弃
    const applied = applyCommands(
      this.workingDocument as unknown as ComponentsDocumentV1,
      list,
      { registry: this.registry },
    );
    if (!applied.ok) {
      return {
        ok: false,
        error: sessionError(applied.code, applied.message, {
          componentId: applied.componentId,
        }),
      };
    }
    const validation = this.codec.validate(applied.document);
    if (!validation.ok) {
      return err(ERROR_CODES.TX_VALIDATION_FAILED, "事务后完整校验失败");
    }

    // 成功：一次性替换 Working
    const previous = this.workingDocument;
    const previousContentHash = this.workingContentHash();
    const previousVersion = this.sessionVersion;
    const frozen = deepFreeze(validation.value as ComponentsDocumentV1);

    this.workingDocument = frozen;
    this.snapshotRef = frozen;
    this.sessionVersion += 1;
    for (const command of list) this.usedCommandIds.add(command.commandId);

    // 历史：一个 Undo 项；清空 Redo；可合并时并入上一条
    const nowMs = this.clock.now();
    this.history.push(this.toHistoryEntry(previous, previousContentHash, previousVersion, options.label, options.mergeKey, nowMs), {
      mayMerge: !this.blockHistoryMerge,
    });
    this.history.clearRedo();
    this.blockHistoryMerge = false;

    if (this.status.kind === "ready") {
      this.status = this.makeReadyStatus();
    }
    // saving / save-error 保持原状态；save-error 仍保持 Dirty

    this.notify();
    if (this.workingContentHash() !== this.savedContentHash) {
      this.addReason("user-edit");
      this.scheduleAutosave();
    } else {
      this.reasons.length = 0;
    }

    return ok(this.buildCommandResult(newUuidV4() as CommandResultV1["transactionId"], frozen));
  }

  canUndo(): boolean {
    return this.history.canUndo;
  }

  canRedo(): boolean {
    return this.history.canRedo;
  }

  undo(): Result<CommandResultV1> {
    if (this.disposed) return err(ERROR_CODES.CMD_SESSION_DISPOSED, "Session 已释放");
    if (!this.isEditable()) {
      return err(ERROR_CODES.CMD_SESSION_NOT_EDITABLE, `当前状态不允许编辑: ${this.status.kind}`);
    }
    const entry = this.history.undoTop;
    if (!entry) return err(ERROR_CODES.CMD_SESSION_NOT_EDITABLE, "没有可撤销的事务");
    const validation = this.codec.validate(entry.document);
    if (!validation.ok) {
      return err(ERROR_CODES.TX_VALIDATION_FAILED, "Undo 目标校验失败");
    }
    const current = this.snapshotRef;
    this.history.popUndoPushRedo(this.toHistoryEntry(current, this.workingContentHash(), this.sessionVersion, "redo", null, this.clock.now()));
    const target = deepFreeze(validation.value as ComponentsDocumentV1);
    this.applyWorkingChange(target);
    this.sessionVersion += 1;
    this.blockHistoryMerge = true;
    this.notify();
    return ok(this.buildCommandResult(newUuidV4() as CommandResultV1["transactionId"], target));
  }

  redo(): Result<CommandResultV1> {
    if (this.disposed) return err(ERROR_CODES.CMD_SESSION_DISPOSED, "Session 已释放");
    if (!this.isEditable()) {
      return err(ERROR_CODES.CMD_SESSION_NOT_EDITABLE, `当前状态不允许编辑: ${this.status.kind}`);
    }
    const entry = this.history.redoTop;
    if (!entry) return err(ERROR_CODES.CMD_SESSION_NOT_EDITABLE, "没有可重做的事务");
    const validation = this.codec.validate(entry.document);
    if (!validation.ok) {
      return err(ERROR_CODES.TX_VALIDATION_FAILED, "Redo 目标校验失败");
    }
    const current = this.snapshotRef;
    this.history.popRedoPushUndo(this.toHistoryEntry(current, this.workingContentHash(), this.sessionVersion, "undo", null, this.clock.now()));
    const target = deepFreeze(validation.value as ComponentsDocumentV1);
    this.applyWorkingChange(target);
    this.sessionVersion += 1;
    this.blockHistoryMerge = true;
    this.notify();
    return ok(this.buildCommandResult(newUuidV4() as CommandResultV1["transactionId"], target));
  }

  save(reason: "manual" | "autosave" | "close"): Promise<Result<SaveResultV1>> {
    if (this.disposed) return Promise.resolve(err(ERROR_CODES.CMD_SESSION_DISPOSED, "Session 已释放"));
    if (reason === "manual") this.clearAutosaveTimer();
    if (this.inFlightSave) {
      this.saveRequestedAgain = true;
      return this.inFlightSave;
    }
    const promise = this.runSave(reason).then(
      (result) => {
        this.inFlightSave = null;
        this.maybeScheduleNextSave();
        return result;
      },
      (failure: unknown) => {
        this.inFlightSave = null;
        throw failure;
      },
    );
    this.inFlightSave = promise;
    return promise;
  }

  /** 12.3.16 仍 Dirty → 安排下一次保存（保存期间的事务重启 debounce）。 */
  private maybeScheduleNextSave(): void {
    if (
      !this.disposed &&
      !this.autosaveBlocked() &&
      this.workingContentHash() !== this.savedContentHash
    ) {
      this.scheduleAutosave();
    }
  }

  async resolveConflict(resolution: ConflictResolutionV1): Promise<Result<void>> {
    if (this.disposed) return err(ERROR_CODES.CMD_SESSION_DISPOSED, "Session 已释放");
    if (this.status.kind !== "conflict" || !this.pendingConflict) {
      return err(ERROR_CODES.CMD_SESSION_NOT_EDITABLE, "当前不在冲突状态");
    }
    const ctx = this.pendingConflict;

    switch (resolution.kind) {
      case "accept-remote": {
        const recoveryResult = await this.writeRecoveryRecord("accept-remote-discard-local", this.workingDocument, this.baseRawHash);
        if (!recoveryResult.ok) return { ok: false, error: recoveryResult.error };
        // 14.10 / 18.10：Remote 再变则旧选择失效
        const current = await this.storage.readText(this.path);
        if (!current.ok) return err(ERROR_CODES.STORAGE_READ_FAILED, "无法读取当前磁盘内容");
        if (current.value.rawHash !== ctx.remoteSnapshot.rawHash) {
          await this.handleExternalSnapshot(current.value);
          return err(ERROR_CODES.MERGE_CONFLICT, "冲突期间远程内容已变化，请重新解决");
        }
        this.adoptRemote(ctx);
        return ok(undefined);
      }
      case "keep-local": {
        const localRecovery = await this.writeRecoveryRecord("keep-local-before-overwrite", this.workingDocument, this.baseRawHash);
        if (!localRecovery.ok) return { ok: false, error: localRecovery.error };
        const remoteRecovery = await this.writeRemoteRecoveryRecord(ctx);
        if (!remoteRecovery.ok) return { ok: false, error: remoteRecovery.error };
        // Remote 作为新 Base，Local 作为 Working，信封 Rebase
        this.baseDocument = ctx.remote;
        this.baseText = ctx.remoteSnapshot.text;
        this.baseRawHash = ctx.remoteSnapshot.rawHash;
        this.baseSemanticHash = this.hashFrom(this.codec.semanticHash(ctx.remote));
        this.baseContentHash = this.hashFrom(this.codec.contentHash(ctx.remote));
        this.savedContentHash = this.baseContentHash;
        const working = deepFreeze({
          ...(ctx.local as unknown as ComponentsDocumentV1),
          revision: ctx.remote.revision,
          updatedAt: ctx.remote.updatedAt,
        });
        this.applyWorkingChange(working);
        this.history.clear();
        this.blockHistoryMerge = true;
        this.pendingConflict = null;
        this.sessionVersion += 1;
        this.reasons = this.workingContentHash() === this.savedContentHash ? [] : ["user-edit"];
        this.status = this.makeReadyStatus();
        // 立即以 Remote 文本 + Raw Hash CAS 保存
        const saveResult = await this.save("manual");
        if (!saveResult.ok) {
          return { ok: false, error: saveResult.error };
        }
        if (saveResult.value.kind === "conflict") {
          return err(ERROR_CODES.MERGE_CONFLICT, "保存时远程再次变化，已生成新冲突上下文");
        }
        return ok(undefined);
      }
      case "manual": {
        const conflictIds = new Set(ctx.conflicts.map((c) => c.id));
        const given = Object.keys(resolution.choices);
        if (given.length !== conflictIds.size || given.some((id) => !conflictIds.has(id as ConflictId))) {
          return err(ERROR_CODES.TX_VALIDATION_FAILED, "choices 必须恰好覆盖全部 ConflictId");
        }
        if (!ctx.autoMergedCandidate) {
          return err(ERROR_CODES.MERGE_RESULT_INVALID, "无自动合并候选，无法手工解决");
        }
        const outcome = threeWayMerge(
          { base: ctx.base, local: ctx.local, remote: ctx.remote, remoteSnapshot: ctx.remoteSnapshot },
          {
            seedConflicts: ctx.conflicts,
            resolve: (c) => resolution.choices[c.id] ?? null,
          },
        );
        if (outcome.aborted || !outcome.candidate) {
          return err(ERROR_CODES.MERGE_CONFLICT, "身份冲突无法手工解决");
        }
        const validation = this.codec.validate(outcome.candidate);
        if (!validation.ok) {
          return err(ERROR_CODES.MERGE_RESULT_INVALID, "解决结果校验失败，保持原冲突");
        }
        const resolved = deepFreeze(validation.value as ComponentsDocumentV1);
        this.baseDocument = ctx.remote;
        this.baseText = ctx.remoteSnapshot.text;
        this.baseRawHash = ctx.remoteSnapshot.rawHash;
        this.baseSemanticHash = this.hashFrom(this.codec.semanticHash(ctx.remote));
        this.baseContentHash = this.hashFrom(this.codec.contentHash(ctx.remote));
        this.savedContentHash = this.baseContentHash;
        this.applyWorkingChange(resolved);
        this.history.clear();
        this.blockHistoryMerge = true;
        this.pendingConflict = null;
        this.sessionVersion += 1;
        this.reasons = this.workingContentHash() === this.savedContentHash ? [] : ["external-merge"];
        this.status = this.makeReadyStatus();
        this.notify();
        if (this.workingContentHash() !== this.savedContentHash) this.scheduleAutosave();
        return ok(undefined);
      }
    }
  }

  async saveCopy(path: string): Promise<Result<FileSnapshotV1>> {
    if (this.disposed) return err(ERROR_CODES.CMD_SESSION_DISPOSED, "Session 已释放");
    const normalized = this.storage.paths.normalize(path);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    const serialized = this.codec.serialize(this.workingDocument);
    if (!serialized.ok) return { ok: false, error: serialized.error };
    return this.storage.writeNewText(normalized.value, serialized.value);
  }

  async dispose(): Promise<Result<void>> {
    if (this.disposed) return err(ERROR_CODES.CMD_SESSION_DISPOSED, "Session 已释放");
    this.clearAutosaveTimer();
    this.firstDirtyAtMs = null;

    if (this.workingContentHash() !== this.savedContentHash) {
      const saveResult = await this.save("close");
      const persisted =
        saveResult.ok &&
        (saveResult.value.kind === "saved" || saveResult.value.kind === "no-op");
      if (!persisted && this.workingContentHash() !== this.savedContentHash) {
        const recoveryResult = await this.writeRecoveryRecord("close-save-failed", this.workingDocument, this.baseRawHash);
        if (!recoveryResult.ok) {
          this.teardown();
          return { ok: false, error: recoveryResult.error };
        }
      }
    }
    this.teardown();
    // 保存失败但 Recovery 成功：成功返回（Result 无 Warning 通道，由 Host 记录）
    return ok(undefined);
  }

  // -------------------------------------------------------------------------
  // 扩展公开方法（Obsidian Adapter / 测试用，不在 DocumentSessionV1 上）
  // -------------------------------------------------------------------------

  /** TextFileView.setViewData 外部文本入口：走与磁盘 Modified 相同的协调流程。 */
  async acceptExternalText(text: string): Promise<Result<void>> {
    if (this.disposed) return err(ERROR_CODES.CMD_SESSION_DISPOSED, "Session 已释放");
    const bytes = new TextEncoder().encode(text);
    const parsed = this.codec.parseUtf8(bytes);
    const snapshot: FileSnapshotV1 = {
      path: this.path,
      text,
      rawHash: sha256HexSync(text),
      mtimeMs: this.clock.now(),
      sizeBytes: bytes.length,
    };
    if (!parsed.ok) {
      this.status = {
        kind: "invalid-external",
        remote: snapshot,
        diagnostics: [],
      };
      this.cancelAutosave();
      this.notify();
      return err(ERROR_CODES.EXTERNAL_FILE_INVALID, "外部文本解析失败");
    }
    await this.handleExternalSnapshot(snapshot, parsed.value);
    return ok(undefined);
  }

  /** 等待外部事件队列与进行中保存排空（测试/关闭前协调）。 */
  async whenIdle(): Promise<void> {
    for (;;) {
      if (this.eventQueueDepth === 0 && this.inFlightSave === null) return;
      if (this.inFlightSave) {
        await this.inFlightSave.catch(() => undefined);
      } else {
        await this.eventChain.catch(() => undefined);
      }
    }
  }

  /** 显式排空外部事件队列。 */
  async flushExternalEvents(): Promise<void> {
    await this.eventChain.catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private eventQueueDepth = 0;

  private workingContentHash(): string {
    return this.hashFrom(this.codec.contentHash(this.workingDocument));
  }

  /** codec 哈希对合法文档恒成功；失败属实现缺陷，抛错暴露。 */
  private hashFrom(result: Result<string>): string {
    if (!result.ok) throw new Error(`哈希计算失败: ${result.error.message}`);
    return result.value;
  }

  private isEditable(): boolean {
    const kind = this.status.kind;
    return kind === "ready" || kind === "saving" || kind === "save-error";
  }

  private makeReadyStatus(): SessionStatusV1 {
    const dirty = this.workingContentHash() !== this.savedContentHash;
    return { kind: "ready", dirty, reasons: this.reasons };
  }

  private addReason(reason: DirtyReasonV1): void {
    if (!this.reasons.includes(reason)) this.reasons.push(reason);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  private buildCommandResult(transactionId: CommandResultV1["transactionId"], document: DeepReadonly<ComponentsDocumentV1>): CommandResultV1 {
    return {
      transactionId,
      sessionVersion: this.sessionVersion,
      contentHash: this.hashFrom(this.codec.contentHash(document)),
      createdComponentIds: [],
      changedComponentIds: [],
      deletedComponentIds: [],
      changedDataSourceIds: [],
      idMap: {},
      diagnostics: [],
    };
  }

  private toHistoryEntry(
    document: DeepReadonly<ComponentsDocumentV1>,
    contentHash: string,
    sessionVersion: number,
    label: string,
    mergeKey: string | null,
    atMs: number,
  ): HistoryEntry {
    return {
      document,
      contentHash,
      sessionVersion,
      label,
      mergeKey,
      atMs,
      bytes: new TextEncoder().encode(JSON.stringify(document)).length,
    };
  }

  /** 无版本冲突地替换 Working（Undo/Redo/Resolution/外部 Reload）。 */
  private applyWorkingChange(document: DeepReadonly<ComponentsDocumentV1>): void {
    this.workingDocument = document;
    this.snapshotRef = document;
    if (this.status.kind === "ready") this.status = this.makeReadyStatus();
    if (this.workingContentHash() === this.savedContentHash) this.reasons.length = 0;
  }

  // -------------------------------------------------------------------------
  // 保存
  // -------------------------------------------------------------------------

  private async runSave(reason: "manual" | "autosave" | "close"): Promise<Result<SaveResultV1>> {
    let first: Result<SaveResultV1> | null = null;
    let currentReason = reason;
    for (;;) {
      if (this.disposed) {
        if (!first) first = err(ERROR_CODES.CMD_SESSION_DISPOSED, "Session 已释放");
        break;
      }
      const round = await this.saveRound(currentReason);
      if (!first) first = round;
      if (!this.saveRequestedAgain) break;
      this.saveRequestedAgain = false;
      if (this.autosaveBlocked()) break;
      currentReason = "autosave";
    }
    return first;
  }

  private async saveRound(reason: "manual" | "autosave" | "close"): Promise<Result<SaveResultV1>> {
    const kind = this.status.kind;
    // 中间经过 Save → 禁止历史合并（10.3 条件 4）
    this.blockHistoryMerge = true;
    if (kind === "conflict") {
      this.saveRequestedAgain = false;
      return err(ERROR_CODES.SAVE_CONFLICT, "冲突状态下不能保存，请先解决冲突");
    }
    if (kind === "missing") {
      this.saveRequestedAgain = false;
      return err(ERROR_CODES.EXTERNAL_FILE_DELETED, "文件已删除，请另存为或恢复路径");
    }
    if (kind === "invalid-external") {
      this.saveRequestedAgain = false;
      return err(ERROR_CODES.EXTERNAL_FILE_INVALID, "外部文件非法，不能覆盖保存");
    }
    if (kind === "read-only") return err(ERROR_CODES.SAVE_READ_ONLY, "只读状态不能保存");
    if (kind === "error" || kind === "loading") {
      return err(ERROR_CODES.SAVE_IO_FAILED, `当前状态不能保存: ${kind}`);
    }
    if (kind === "save-error" && this.status.storageState === "unknown") {
      return err(ERROR_CODES.SAVE_IO_FAILED, "磁盘状态未知，必须先重新读取并协调");
    }

    // 12.3.2 Clean → no-op，不增加 Revision
    if (this.workingContentHash() === this.savedContentHash) {
      return ok({ kind: "no-op", reason: "clean", snapshot: this.lastDiskSnapshot });
    }

    const captured = this.snapshotRef;
    const capturedVersion = this.sessionVersion;
    const validation = this.codec.validate(captured);
    if (!validation.ok) {
      return err(ERROR_CODES.TX_VALIDATION_FAILED, "保存快照校验失败");
    }
    const baseRevision = this.baseDocument.revision;
    if (baseRevision >= Number.MAX_SAFE_INTEGER) {
      return err(ERROR_CODES.DOC_REVISION_OVERFLOW, "Revision 达到上限");
    }
    const candidate: ComponentsDocumentV1 = {
      ...(captured as unknown as ComponentsDocumentV1),
      revision: baseRevision + 1,
      updatedAt: utcIso(this.clock.now()),
    };
    const serialized = this.codec.serialize(candidate);
    if (!serialized.ok) return { ok: false, error: serialized.error };
    const nextText = serialized.value;
    const candidateSemantic = this.hashFrom(this.codec.semanticHash(candidate));
    const candidateContent = this.hashFrom(this.codec.contentHash(candidate));

    this.status = { kind: "saving", dirty: true, reasons: this.reasons };
    this.notify();

    // 12.3.9 CAS；预先登记 own-write Hash 以消重同步到达的 Modified 事件
    const nextRawHash = sha256HexSync(nextText);
    this.registerOwnWriteHash(nextRawHash);
    const cas = await this.storage.compareAndSwapText({
      path: this.path,
      expectedText: this.baseText,
      expectedRawHash: this.baseRawHash,
      nextText,
    });
    if (!cas.ok) {
      this.expectedOwnWriteHash.delete(nextRawHash);
      return this.recoverFromCasError(cas.error, reason);
    }
    switch (cas.value.kind) {
      case "written":
        return this.handleWritten(cas.value.snapshot, nextText, candidate, candidateSemantic, candidateContent, capturedVersion);
      case "conflict": {
        this.expectedOwnWriteHash.delete(nextRawHash);
        this.saveRequestedAgain = false;
        const current = cas.value.current;
        const parsed = this.codec.parseUtf8(new TextEncoder().encode(current.text));
        if (!parsed.ok) {
          this.status = { kind: "invalid-external", remote: current, diagnostics: [] };
          this.cancelAutosave();
          this.notify();
          return err(ERROR_CODES.EXTERNAL_FILE_INVALID, "冲突文件无法解析");
        }
        await this.reconcileRemote(current, parsed.value);
        return ok({ kind: "conflict", current });
      }
      case "missing": {
        this.expectedOwnWriteHash.delete(nextRawHash);
        this.saveRequestedAgain = false;
        this.status = { kind: "missing", lastKnownPath: this.path };
        this.cancelAutosave();
        this.notify();
        return ok({ kind: "missing", lastKnownPath: this.path });
      }
      case "indeterminate":
        return this.handleIndeterminate(cas.value, nextText, candidate, candidateSemantic, candidateContent, capturedVersion, reason);
    }
  }

  /** 12.4 存储不确定协调：四路（Written / Remote / Invalid / Unknown）。 */
  private async handleIndeterminate(
    result: Extract<CasTextResultV1, { kind: "indeterminate" }>,
    nextText: string,
    candidate: ComponentsDocumentV1,
    candidateSemantic: string,
    candidateContent: string,
    capturedVersion: number,
    _reason: "manual" | "autosave" | "close",
  ): Promise<Result<SaveResultV1>> {
    this.saveRequestedAgain = false;
    this.expectedOwnWriteHash.delete(sha256HexSync(nextText));
    let current = result.current;
    if (!current) {
      const read = await this.storage.readText(this.path);
      if (!read.ok) {
        this.status = { kind: "save-error", dirty: true, storageState: "unknown", error: toRuntimeError(read.error) };
        this.cancelAutosave();
        this.notify();
        return ok({ kind: "indeterminate", current: null, error: toRuntimeError(read.error) });
      }
      current = read.value;
    }
    if (current.text === nextText) {
      return this.handleWritten(current, nextText, candidate, candidateSemantic, candidateContent, capturedVersion);
    }
    const parsed = this.codec.parseUtf8(new TextEncoder().encode(current.text));
    if (!parsed.ok) {
      this.status = { kind: "invalid-external", remote: current, diagnostics: [] };
      this.cancelAutosave();
      this.notify();
      return err(ERROR_CODES.EXTERNAL_FILE_INVALID, "磁盘内容无法解析");
    }
    await this.reconcileRemote(current, parsed.value);
    return ok({ kind: "indeterminate", current, error: result.error });
  }

  /** CAS 写成功（12.3 步骤 13～17）。 */
  private async handleWritten(
    snapshot: FileSnapshotV1,
    nextText: string,
    candidate: ComponentsDocumentV1,
    candidateSemantic: string,
    candidateContent: string,
    capturedVersion: number,
  ): Promise<Result<SaveResultV1>> {
    const reparsed = this.codec.parseUtf8(new TextEncoder().encode(snapshot.text));
    if (!reparsed.ok || reparsed.value.semanticHash !== candidateSemantic) {
      // 12.3.13 验证失败：保留 Working；磁盘可读则协调，否则 unknown
      const read = await this.storage.readText(this.path);
      if (read.ok) {
        const parsed = this.codec.parseUtf8(new TextEncoder().encode(read.value.text));
        if (parsed.ok) {
          await this.reconcileRemote(read.value, parsed.value);
        } else {
          this.status = { kind: "invalid-external", remote: read.value, diagnostics: [] };
          this.cancelAutosave();
          this.notify();
        }
      } else {
        this.status = { kind: "save-error", dirty: true, storageState: "unknown", error: toRuntimeError(read.error) };
        this.cancelAutosave();
        this.notify();
      }
      return err(ERROR_CODES.SAVE_VERIFY_FAILED, "写后回读验证失败");
    }
    const confirmed = reparsed.value.document;
    this.baseDocument = confirmed;
    this.baseText = snapshot.text;
    this.baseRawHash = snapshot.rawHash;
    this.baseSemanticHash = candidateSemantic;
    this.baseContentHash = candidateContent;
    this.savedContentHash = candidateContent;
    this.lastDiskSnapshot = snapshot;

    // 12.3.15 Rebase 新信封到 Working（不创建 Undo、不增加 Version）
    const working = this.workingDocument;
    if (working.revision !== confirmed.revision || working.updatedAt !== confirmed.updatedAt) {
      const rebased = deepFreeze({
        ...(working as unknown as ComponentsDocumentV1),
        revision: confirmed.revision,
        updatedAt: confirmed.updatedAt,
      });
      this.workingDocument = rebased;
      this.snapshotRef = rebased;
    }

    const stillDirty = this.workingContentHash() !== this.savedContentHash;
    this.blockHistoryMerge = true;
    this.consecutiveSaveFailures = 0;
    if (stillDirty) {
      this.scheduleAutosave();
    } else {
      this.reasons.length = 0;
      this.firstDirtyAtMs = null;
      this.clearAutosaveTimer();
    }
    this.status = { kind: "ready", dirty: stillDirty, reasons: this.reasons };
    this.notify();
    return ok({
      kind: "saved",
      snapshot,
      persistedRevision: confirmed.revision,
      savedSessionVersion: capturedVersion,
      stillDirty,
    });
  }

  /** CAS 调用本身失败：确认磁盘未变 → confirmed-base；变化 → 外部协调。 */
  private async recoverFromCasError(
    storageError: ProtocolError,
    reason: "manual" | "autosave" | "close",
  ): Promise<Result<SaveResultV1>> {
    const read = await this.storage.readText(this.path);
    if (!read.ok) {
      if (read.error.details && read.error.details.missing === true) {
        this.status = { kind: "missing", lastKnownPath: this.path };
        this.cancelAutosave();
        this.notify();
        return err(ERROR_CODES.EXTERNAL_FILE_DELETED, "文件已删除");
      }
      this.status = { kind: "save-error", dirty: true, storageState: "unknown", error: toRuntimeError(storageError) };
      this.cancelAutosave();
      this.notify();
      return { ok: false, error: storageError };
    }
    if (read.value.rawHash === this.baseRawHash) {
      this.status = { kind: "save-error", dirty: true, storageState: "confirmed-base", error: toRuntimeError(storageError) };
      this.notify();
      if (reason === "autosave") {
        this.consecutiveSaveFailures += 1;
        this.scheduleAutosave();
      }
      return { ok: false, error: storageError };
    }
    const parsed = this.codec.parseUtf8(new TextEncoder().encode(read.value.text));
    if (!parsed.ok) {
      this.status = { kind: "invalid-external", remote: read.value, diagnostics: [] };
      this.cancelAutosave();
      this.notify();
      return err(ERROR_CODES.EXTERNAL_FILE_INVALID, "磁盘内容无法解析");
    }
    await this.reconcileRemote(read.value, parsed.value);
    return err(ERROR_CODES.SAVE_IO_FAILED, "写入失败，已按磁盘状态协调");
  }

  // -------------------------------------------------------------------------
  // 外部事件（13 章）
  // -------------------------------------------------------------------------

  private enqueueExternalEvent(event: StorageEventV1): void {
    this.eventQueueDepth += 1;
    this.eventChain = this.eventChain
      .then(() => this.handleExternalEvent(event))
      .catch(() => undefined)
      .finally(() => {
        this.eventQueueDepth -= 1;
      });
  }

  private async handleExternalEvent(event: StorageEventV1): Promise<void> {
    if (this.disposed) return;
    switch (event.kind) {
      case "modified":
      case "created":
        await this.handleExternalModified(event.path);
        return;
      case "renamed":
        await this.handleExternalRenamed(event.oldPath, event.newPath);
        return;
      case "deleted":
        this.handleExternalDeleted(event.path);
        return;
    }
  }

  /** 13.2 Modified / Created：Raw Hash → Own Write → Parse → 协调。 */
  private async handleExternalModified(path: string): Promise<void> {
    if (this.disposed) return;
    if (path !== this.path) return;
    const read = await this.storage.readText(path);
    if (!read.ok) {
      if (read.error.details && read.error.details.missing === true) {
        this.status = { kind: "missing", lastKnownPath: path };
        this.cancelAutosave();
        this.notify();
      } else {
        this.status = { kind: "save-error", dirty: true, storageState: "unknown", error: toRuntimeError(read.error) };
        this.notify();
      }
      return;
    }
    await this.handleExternalSnapshot(read.value);
  }

  /** 以磁盘/视图快照协调（含 CAS 冲突、indeterminate、acceptExternalText）。 */
  private async handleExternalSnapshot(snapshot: FileSnapshotV1, preParsed?: ParsedDocumentV1): Promise<void> {
    if (this.disposed) return;
    // 13.2.3 Raw Hash 等于 Base → 忽略
    if (snapshot.rawHash === this.baseRawHash) return;
    // 13.2.4 自身写入 → 消费并忽略
    if (this.expectedOwnWriteHash.delete(snapshot.rawHash)) return;

    const parsed = preParsed !== undefined
      ? ({ ok: true as const, value: preParsed } as { ok: true; value: ParsedDocumentV1 })
      : this.codec.parseUtf8(new TextEncoder().encode(snapshot.text));
    if (!parsed.ok) {
      this.blockHistoryMerge = true;
      this.status = {
        kind: "invalid-external",
        remote: snapshot,
        diagnostics: [
          {
            code: parsed.error.code,
            severity: "error",
            message: parsed.error.message,
            pointer: (parsed.error.details?.pointer as string | undefined) ?? null,
            componentId: null,
            recoverable: parsed.error.recoverable,
            details: parsed.error.details ?? {},
          },
        ],
      };
      this.cancelAutosave();
      this.notify();
      return;
    }
    await this.reconcileRemote(snapshot, parsed.value);
  }

  /** 13.2.6～10 + 14 章：语义相等 → 纯字节事件；Content 相等 → 收信封；Clean → 重载；Dirty → Merge。 */
  private async reconcileRemote(snapshot: FileSnapshotV1, parsed: ParsedDocumentV1): Promise<void> {
    if (this.disposed) return;
    const remote = parsed.document;
    this.lastDiskSnapshot = snapshot;
    // 中间经过外部事件 → 禁止历史合并（10.3 条件 4）
    this.blockHistoryMerge = true;

    // 13.2.7 纯字节/格式事件：只更新 Base Text + Raw Hash
    if (parsed.semanticHash === this.baseSemanticHash) {
      this.baseText = snapshot.text;
      this.baseRawHash = snapshot.rawHash;
      this.notify();
      return;
    }
    // 13.2.8 信封事件：接受 Remote 信封，Rebase 到 Working，不改变 Dirty
    if (parsed.contentHash === this.baseContentHash) {
      this.baseDocument = remote;
      this.baseText = snapshot.text;
      this.baseRawHash = snapshot.rawHash;
      this.baseSemanticHash = parsed.semanticHash;
      this.baseContentHash = parsed.contentHash;
      const working = this.workingDocument;
      if (working.revision !== remote.revision || working.updatedAt !== remote.updatedAt) {
        const rebased = deepFreeze({
          ...(working as unknown as ComponentsDocumentV1),
          revision: remote.revision,
          updatedAt: remote.updatedAt,
        });
        this.workingDocument = rebased;
        this.snapshotRef = rebased;
      }
      this.notify();
      return;
    }
    // 13.2.9 Clean → 以 Remote 替换 Base 和 Working
    if (this.workingContentHash() === this.savedContentHash) {
      this.baseDocument = remote;
      this.baseText = snapshot.text;
      this.baseRawHash = snapshot.rawHash;
      this.baseSemanticHash = parsed.semanticHash;
      this.baseContentHash = parsed.contentHash;
      this.savedContentHash = parsed.contentHash;
      this.workingDocument = remote;
      this.snapshotRef = remote;
      this.sessionVersion += 1;
      this.history.clear();
      this.blockHistoryMerge = true;
      this.reasons.length = 0;
      this.status = this.makeReadyStatus();
      this.notify();
      return;
    }
    // 13.2.10 Dirty → 三方 Merge（14 章）
    await this.mergeRemote(snapshot, parsed);
  }

  /** 三方 Merge（14.1–14.9）。 */
  private async mergeRemote(snapshot: FileSnapshotV1, parsed: ParsedDocumentV1): Promise<void> {
    if (this.disposed) return;
    const remote = parsed.document;
    const outcome = threeWayMerge({
      base: this.baseDocument,
      local: this.workingDocument,
      remote,
      remoteSnapshot: snapshot,
    });
    if (outcome.aborted) {
      this.pendingConflict = {
        base: this.baseDocument,
        local: this.workingDocument,
        remote,
        remoteSnapshot: snapshot,
        autoMergedCandidate: null,
        conflicts: outcome.conflicts,
      };
      this.status = { kind: "conflict", context: this.pendingConflict };
      this.cancelAutosave();
      this.notify();
      return;
    }
    if (!outcome.candidate) {
      this.pendingConflict = {
        base: this.baseDocument,
        local: this.workingDocument,
        remote,
        remoteSnapshot: snapshot,
        autoMergedCandidate: null,
        conflicts: outcome.conflicts,
      };
      this.status = { kind: "conflict", context: this.pendingConflict };
      this.cancelAutosave();
      this.notify();
      return;
    }
    const validation = this.codec.validate(outcome.candidate);
    if (!validation.ok) {
      // 14.9.2 MERGE_RESULT_INVALID → Conflict（无候选；用户只能 Accept/Keep/另存）
      this.pendingConflict = {
        base: this.baseDocument,
        local: this.workingDocument,
        remote,
        remoteSnapshot: snapshot,
        autoMergedCandidate: null,
        conflicts: outcome.conflicts,
      };
      this.status = { kind: "conflict", context: this.pendingConflict };
      this.cancelAutosave();
      this.notify();
      return;
    }
    if (outcome.conflicts.length > 0) {
      this.pendingConflict = {
        base: this.baseDocument,
        local: this.workingDocument,
        remote,
        remoteSnapshot: snapshot,
        autoMergedCandidate: validation.value as DeepReadonly<ComponentsDocumentV1>,
        conflicts: outcome.conflicts,
      };
      this.status = { kind: "conflict", context: this.pendingConflict };
      this.cancelAutosave();
      this.notify();
      return;
    }

    // 14.9 自动 Merge 成功
    const merged = deepFreeze(validation.value as ComponentsDocumentV1);
    this.baseDocument = remote;
    this.baseText = snapshot.text;
    this.baseRawHash = snapshot.rawHash;
    this.baseSemanticHash = parsed.semanticHash;
    this.baseContentHash = parsed.contentHash;
    this.savedContentHash = parsed.contentHash;
    this.workingDocument = merged;
    this.snapshotRef = merged;
    this.sessionVersion += 1;
    this.history.clear();
    this.blockHistoryMerge = true;
    this.pendingConflict = null;
    const dirty = this.workingContentHash() !== this.savedContentHash;
    this.reasons = dirty ? ["external-merge"] : [];
    this.status = { kind: "ready", dirty, reasons: this.reasons };
    this.notify();
    if (dirty) this.scheduleAutosave();
  }

  /** 13.3 Rename：更新路径、缓存 Key、订阅；内容变化继续 Modified 流程。 */
  private async handleExternalRenamed(oldPath: string, newPath: string): Promise<void> {
    if (this.disposed) return;
    if (oldPath !== this.path) return;
    const normalized = this.storage.paths.normalize(newPath);
    if (!normalized.ok) return;
    const nextPath = normalized.value;
    if (nextPath === this.path) return;

    // 13.3.4 getPath() 立即返回新路径
    this.path = nextPath;
    if (this.storageUnsubscribe) {
      this.storageUnsubscribe();
      this.storageUnsubscribe = null;
    }
    this.storageUnsubscribe = this.storage.subscribe(nextPath, (event) => {
      this.enqueueExternalEvent(event);
    });
    this.onRename(oldPath, nextPath);

    const read = await this.storage.readText(nextPath);
    if (!read.ok) {
      if (read.error.details && read.error.details.missing === true) {
        this.status = { kind: "missing", lastKnownPath: nextPath };
        this.cancelAutosave();
      }
      this.notify();
      return;
    }
    if (read.value.rawHash !== this.baseRawHash) {
      // 13.3.5 内容变化：确认身份后继续 Modified 流程
      const docId = this.documentIdOf ? this.documentIdOf(nextPath) : null;
      const parsed = this.codec.parseUtf8(new TextEncoder().encode(read.value.text));
      if (parsed.ok && docId !== null && docId !== this.documentId) {
        // 13.3 双文件/身份不同 → conflict/document-identity
        this.pendingConflict = {
          base: this.baseDocument,
          local: this.workingDocument,
          remote: parsed.value.document,
          remoteSnapshot: read.value,
          autoMergedCandidate: null,
          conflicts: [{
            id: newUuidV4() as ConflictId,
            kind: "document-identity",
            pointer: "/documentId",
            componentId: null,
            base: { kind: "value", value: this.documentId },
            local: { kind: "value", value: this.documentId },
            remote: { kind: "value", value: docId },
          }],
        };
        this.status = { kind: "conflict", context: this.pendingConflict };
        this.cancelAutosave();
        this.notify();
        return;
      }
      if (!parsed.ok) {
        this.status = { kind: "invalid-external", remote: read.value, diagnostics: [] };
        this.cancelAutosave();
        this.notify();
        return;
      }
      await this.handleExternalSnapshot(read.value, parsed.value);
    }
    // 13.3.6 Rename 本身：不增加 Version、不创建 Undo、不标 Dirty
    this.notify();
  }

  /** 13.4 Delete：进入 missing，保留 Working/Undo/Redo/Hash，取消 Autosave。 */
  private handleExternalDeleted(path: string): void {
    if (this.disposed) return;
    if (path !== this.path) return;
    this.blockHistoryMerge = true;
    this.status = { kind: "missing", lastKnownPath: path };
    this.cancelAutosave();
    this.notify();
  }

  /** 14.9 / 13.2 收尾：Accept Remote 或 Clean Reload 共用。 */
  private adoptRemote(ctx: PendingConflictV1): void {
    const remote = ctx.remote;
    this.baseDocument = remote;
    this.baseText = ctx.remoteSnapshot.text;
    this.baseRawHash = ctx.remoteSnapshot.rawHash;
    this.baseSemanticHash = this.hashFrom(this.codec.semanticHash(remote));
    this.baseContentHash = this.hashFrom(this.codec.contentHash(remote));
    this.savedContentHash = this.baseContentHash;
    this.workingDocument = remote;
    this.snapshotRef = remote;
    this.sessionVersion += 1;
    this.history.clear();
    this.blockHistoryMerge = true;
    this.pendingConflict = null;
    this.reasons.length = 0;
    this.status = { kind: "ready", dirty: false, reasons: [] };
    this.notify();
  }

  // -------------------------------------------------------------------------
  // Recovery / Autosave / 清理
  // -------------------------------------------------------------------------

  private async writeRecoveryRecord(
    reason: import("@ocs/contracts/document").RecoveryReasonV1,
    document: DeepReadonly<ComponentsDocumentV1>,
    baseRawHash: string | null,
  ): Promise<Result<import("@ocs/contracts").RecoveryRecordV1>> {
    const serialized = this.codec.serialize(document);
    if (!serialized.ok) return { ok: false, error: serialized.error };
    const contentHash = this.hashFrom(this.codec.contentHash(document));
    const nowMs = this.clock.now();
    const record: import("@ocs/contracts").RecoveryRecordV1 = {
      kind: "components-studio/recovery",
      recordVersion: 1,
      recordId: buildRecordId(nowMs, contentHash),
      vaultId: this.vaultId,
      documentId: document.documentId,
      originPath: this.path,
      baseRawHash,
      contentHash,
      createdAt: utcIso(nowMs),
      reason,
      documentText: serialized.value,
    };
    return this.recovery.writeRecovery(record);
  }

  private async writeRemoteRecoveryRecord(ctx: PendingConflictV1): Promise<Result<import("@ocs/contracts").RecoveryRecordV1>> {
    const remote = ctx.remote;
    const contentHash = this.hashFrom(this.codec.contentHash(remote));
    const nowMs = this.clock.now();
    const record: import("@ocs/contracts").RecoveryRecordV1 = {
      kind: "components-studio/recovery",
      recordVersion: 1,
      recordId: buildRecordId(nowMs, contentHash),
      vaultId: this.vaultId,
      documentId: remote.documentId,
      originPath: this.path,
      baseRawHash: ctx.remoteSnapshot.rawHash,
      contentHash,
      createdAt: utcIso(nowMs),
      reason: "keep-local-before-overwrite",
      documentText: ctx.remoteSnapshot.text,
    };
    return this.recovery.writeRecovery(record);
  }

  private registerOwnWriteHash(rawHash: string): void {
    this.expectedOwnWriteHash.add(rawHash);
    if (this.expectedOwnWriteHash.size > OWN_WRITE_HASH_CAP) {
      const oldest = this.expectedOwnWriteHash.values().next().value as string | undefined;
      if (oldest !== undefined) this.expectedOwnWriteHash.delete(oldest);
    }
  }

  private autosaveBlocked(): boolean {
    const kind = this.status.kind;
    return (
      kind === "conflict" ||
      kind === "invalid-external" ||
      kind === "missing" ||
      kind === "read-only" ||
      kind === "error" ||
      kind === "disposed" ||
      kind === "loading" ||
      (kind === "save-error" && this.status.storageState === "unknown")
    );
  }

  private cancelAutosave(): void {
    this.clearAutosaveTimer();
    this.firstDirtyAtMs = null;
  }

  private clearAutosaveTimer(): void {
    if (this.autosaveTimer) {
      this.autosaveTimer.dispose();
      this.autosaveTimer = null;
    }
  }

  /** 12.6 Autosave：750ms trailing debounce + 首次 Dirty 起 5s 上限 + 失败指数退避。 */
  private scheduleAutosave(): void {
    if (this.disposed || this.autosaveBlocked()) return;
    if (this.inFlightSave) return; // 完成回调会安排下一轮
    const now = this.clock.now();
    if (this.firstDirtyAtMs === null) this.firstDirtyAtMs = now;
    this.clearAutosaveTimer();
    let delay: number;
    if (this.consecutiveSaveFailures > 0) {
      delay = Math.min(AUTOSAVE_BACKOFF_MAX_MS, AUTOSAVE_DEBOUNCE_MS * Math.pow(2, this.consecutiveSaveFailures));
    } else {
      const elapsed = now - this.firstDirtyAtMs;
      const cap = Math.max(0, AUTOSAVE_MAX_DELAY_MS - elapsed);
      delay = Math.min(AUTOSAVE_DEBOUNCE_MS, cap);
    }
    this.autosaveTimer = this.clock.timeout(() => {
      this.autosaveTimer = null;
      void this.runAutosave();
    }, delay);
  }

  private async runAutosave(): Promise<void> {
    if (this.disposed || this.autosaveBlocked()) return;
    if (this.workingContentHash() === this.savedContentHash) {
      this.firstDirtyAtMs = null;
      return;
    }
    await this.save("autosave");
  }

  private teardown(): void {
    this.disposed = true;
    this.status = { kind: "disposed" };
    this.clearAutosaveTimer();
    this.firstDirtyAtMs = null;
    if (this.storageUnsubscribe) {
      this.storageUnsubscribe();
      this.storageUnsubscribe = null;
    }
    this.pendingConflict = null;
    this.onDisposed(this.path);
    this.notify();
  }
}

/**
 * RuntimeDocumentPort 适配（运行时协议 3.1）：把 DocumentSessionV1 包装成
 * Runtime 消费的 DocumentSnapshot + 状态映射。Obsidian 层无需自行适配。
 *
 * useSyncExternalStore 要求 getSnapshot 在无变化时返回同一引用：
 * session.getSnapshot() 在 sessionVersion 不变时保证引用稳定，
 * save 信封 rebase 时返回新引用并发布通知——以此引用做缓存键，
 * 既能避免无限重渲染，又能让信封变化正确传导。
 */
export function toRuntimeDocumentPort(
  session: DocumentSessionV1,
): import("../runtime/types").RuntimeDocumentPort {
  let cachedDoc: import("@ocs/contracts").DeepReadonly<import("@ocs/contracts").ComponentsDocumentV1> | null = null;
  let cached:
    | import("../runtime/types").DocumentSnapshot
    | null = null;
  return {
    getSnapshot() {
      const doc = session.getSnapshot();
      if (doc === cachedDoc && cached !== null) {
        return cached;
      }
      cachedDoc = doc;
      const nodes = new Map<import("@ocs/contracts").ComponentId, import("@ocs/contracts").ComponentNodeV1>();
      for (const [id, node] of Object.entries(doc.nodes)) {
        nodes.set(id as import("@ocs/contracts").ComponentId, node as unknown as import("@ocs/contracts").ComponentNodeV1);
      }
      const dataSources = new Map<import("@ocs/contracts").DataSourceId, import("@ocs/contracts").PersistedDataSourceSpecV1>();
      for (const [id, ds] of Object.entries(doc.dataSources)) {
        dataSources.set(id as import("@ocs/contracts").DataSourceId, ds as unknown as import("@ocs/contracts").PersistedDataSourceSpecV1);
      }
      cached = {
        documentId: doc.documentId,
        sourcePath: session.getPath(),
        sessionVersion: session.getSessionVersion(),
        revision: doc.revision,
        rootId: doc.rootId,
        nodes,
        dataSources,
        permissions: doc.permissions as unknown as import("@ocs/contracts").PermissionManifestV1,
        metadata: doc.metadata as unknown as import("@ocs/contracts").DocumentMetadataV1,
      };
      return cached;
    },
    subscribe(listener: () => void) {
      return session.subscribe(listener);
    },
    getStatus() {
      const status = session.getStatus();
      switch (status.kind) {
        case "ready":
        case "saving":
          return { kind: status.kind, dirty: status.dirty };
        case "conflict":
          return { kind: "conflict" };
        case "invalid-external":
          return { kind: "invalid-external" };
        case "missing":
          return { kind: "missing" };
        case "read-only":
          return { kind: "read-only", reason: status.reason };
        case "disposed":
          return { kind: "disposed" };
        case "loading":
        case "save-error":
        case "error":
          return { kind: "read-only", reason: status.kind };
      }
    },
  };
}

export type { DiagnosticV1 };
