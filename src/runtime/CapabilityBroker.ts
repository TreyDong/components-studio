/**
 * CapabilityBroker（《运行时与 SDK 协议 v1》第 8.1 节）。
 *
 * evaluate() 四路 AND：
 *   Definition.manifest.declaredCapabilities 包含 capability
 *   AND 文档 permissions.requested 包含 capability
 *   AND 插件全局策略未禁止（MVP：network:request 一律拒绝）
 *   AND RuntimeMode 允许
 *   AND 内置策略或用户 Grant 允许
 *
 * requestGrant() 要求同一次同步入口消费并签发的 VerifiedActionTrigger，
 * 否则直接拒绝（不会弹出授权窗口）。
 */
import type {
  ActionTrigger,
} from "./action-types";
import type {
  Capability,
  CapabilityBroker as CapabilityBrokerPort,
  CapabilityDecision,
  CapabilityDecisionSource,
  CapabilityGrant,
  CapabilityGrantStore,
  CapabilitySubject,
} from "./capability-types";
import type { RuntimeMode } from "./types";
import type { RuntimeDocumentPort } from "./types";
import type { CommandPort, ConfirmationPort } from "../platform/ports";
import type { ComponentRegistry } from "../registry/ComponentRegistry";
import type {
  ComponentId,
  DocumentId,
  JsonObject,
  Result,
  VaultId,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import { newUuidV4 } from "../shared/id";

/** 内置组件的 vendor（与 Registry Manifest 的 vendor 约定一致）。 */
export const BUILTIN_VENDOR = "components-studio";

/** 需要用户手势的内置能力（策略表 8.1）。 */
const GESTURE_REQUIRED_BUILTIN: ReadonlySet<Capability> = new Set<Capability>([
  "workspace:navigate",
  "clipboard:write",
  "vault:create",
  "vault:modify",
  "external-url:open",
  "command:execute",
]);

/** 文档声明后内置直接允许的能力。 */
const BUILTIN_AUTO_GRANT: ReadonlySet<Capability> = new Set<Capability>([
  "query:read",
  "timer:use",
  "vault:read",
]);

/** MVP 一律拒绝的能力（自定义组件默认拒绝集也含 command:execute）。 */
const MVP_DENIED: ReadonlySet<Capability> = new Set<Capability>(["network:request"]);

/** 自定义组件默认拒绝（设置页开启后才可能首次授权）。 */
const CUSTOM_DEFAULT_DENIED: ReadonlySet<Capability> = new Set<Capability>([
  "command:execute",
  "network:request",
]);

/** edit 模式下禁止的能力（协议 5.5）。 */
const EDIT_DENIED: ReadonlySet<Capability> = new Set<Capability>([
  "workspace:navigate",
  "vault:create",
  "vault:modify",
  "clipboard:write",
  "command:execute",
  "external-url:open",
]);

export class InMemoryCapabilityGrantStore implements CapabilityGrantStore {
  private readonly grants: CapabilityGrant[] = [];

  list(): readonly CapabilityGrant[] {
    return this.grants;
  }

  async put(grant: CapabilityGrant): Promise<Result<void>> {
    this.grants.push(grant);
    return { ok: true, value: undefined };
  }

  async revoke(grantId: string): Promise<Result<void>> {
    const index = this.grants.findIndex((g) => g.grantId === grantId);
    if (index >= 0) {
      this.grants.splice(index, 1);
    }
    return { ok: true, value: undefined };
  }

  async revokeForDocument(
    vaultId: VaultId,
    documentId: DocumentId,
  ): Promise<Result<void>> {
    for (let i = this.grants.length - 1; i >= 0; i--) {
      const g = this.grants[i]!;
      if (g.vaultId === vaultId && g.documentId === documentId) {
        this.grants.splice(i, 1);
      }
    }
    return { ok: true, value: undefined };
  }
}

export interface CapabilityBrokerOptions {
  readonly registry: ComponentRegistry;
  readonly document: RuntimeDocumentPort;
  readonly confirmations: ConfirmationPort;
  readonly commands: CommandPort;
  readonly grants: CapabilityGrantStore;
  readonly vaultId: VaultId;
}

function decision(
  capability: Capability,
  granted: boolean,
  source: CapabilityDecisionSource,
  reason: string,
  grantId?: string,
): CapabilityDecision {
  return { capability, granted, source, reason, ...(grantId ? { grantId } : {}) };
}

function packageMajorOf(packageVersion: string): number {
  const major = packageVersion.split(".")[0];
  const n = Number(major);
  return Number.isFinite(n) ? n : 0;
}

export class CapabilityBroker implements CapabilityBrokerPort {
  private readonly registry: ComponentRegistry;
  private readonly document: RuntimeDocumentPort;
  private readonly confirmations: ConfirmationPort;
  private readonly commands: CommandPort;
  private readonly grants: CapabilityGrantStore;
  private readonly vaultId: VaultId;

  constructor(options: CapabilityBrokerOptions) {
    this.registry = options.registry;
    this.document = options.document;
    this.confirmations = options.confirmations;
    this.commands = options.commands;
    this.grants = options.grants;
    this.vaultId = options.vaultId;
  }

  evaluate(
    subject: CapabilitySubject,
    capability: Capability,
    mode: RuntimeMode,
  ): CapabilityDecision {
    if (MVP_DENIED.has(capability)) {
      return decision(
        capability,
        false,
        "mvp-deny",
        `${capability} 在 MVP 中一律拒绝`,
      );
    }
    const registered = this.registry.get(subject.componentType);
    if (!registered || !registered.manifest.declaredCapabilities.includes(capability)) {
      return decision(
        capability,
        false,
        "definition-not-declared",
        `Definition（${subject.componentType}）未声明能力 ${capability}`,
      );
    }
    const requested = this.document
      .getSnapshot()
      .permissions.requested.some((r) => r.capability === capability);
    if (!requested) {
      return decision(
        capability,
        false,
        "document-not-requested",
        `文档未请求能力 ${capability}`,
      );
    }
    const modeDenied = this.modeDenies(capability, mode);
    if (modeDenied) {
      return decision(
        capability,
        false,
        "runtime-mode-deny",
        `模式 ${mode} 禁止能力 ${capability}`,
      );
    }
    // 用户 Grant：唯一匹配键 vaultId+documentId+vendor+packageMajor+componentType+capability。
    const grant = this.grants
      .list()
      .find(
        (g) =>
          g.vaultId === subject.vaultId &&
          g.documentId === subject.documentId &&
          g.vendor === subject.vendor &&
          g.packageMajor === packageMajorOf(subject.packageVersion) &&
          g.componentType === subject.componentType &&
          g.capability === capability,
      );
    if (grant) {
      return decision(capability, true, "user-grant", "用户已授权", grant.grantId);
    }
    if (subject.vendor === BUILTIN_VENDOR) {
      if (BUILTIN_AUTO_GRANT.has(capability)) {
        return decision(
          capability,
          true,
          "built-in-policy",
          "内置组件在文档声明后允许",
        );
      }
      if (GESTURE_REQUIRED_BUILTIN.has(capability)) {
        return decision(
          capability,
          false,
          "built-in-policy",
          "需要已验证的用户手势（首次授权或确认）",
        );
      }
    }
    if (CUSTOM_DEFAULT_DENIED.has(capability)) {
      return decision(
        capability,
        false,
        "global-deny",
        "自定义组件默认拒绝该能力",
      );
    }
    return decision(
      capability,
      false,
      "built-in-policy",
      "自定义组件首次使用需要授权",
    );
  }

  async requestGrant(input: {
    readonly subject: CapabilitySubject;
    readonly capability: Capability;
    readonly reason: string;
    readonly mode: RuntimeMode;
    readonly trigger: ActionTrigger;
  }): Promise<CapabilityDecision> {
    const { subject, capability, reason, mode, trigger } = input;
    if (!trigger.verifiedGesture) {
      return decision(
        capability,
        false,
        "runtime-mode-deny",
        "缺少已验证的用户手势：授权窗口只能在同步手势入口内弹出",
      );
    }
    if (MVP_DENIED.has(capability)) {
      return decision(capability, false, "mvp-deny", `${capability} 在 MVP 中一律拒绝`);
    }
    const already = this.evaluate(subject, capability, mode);
    if (already.granted) return already;
    if (this.modeDenies(capability, mode)) return already;

    const isBuiltin = subject.vendor === BUILTIN_VENDOR;
    if (isBuiltin && capability === "workspace:navigate") {
      // 策略表：内置组件 workspace:navigate 在手势下直接允许，无需存储授权。
      return decision(
        capability,
        true,
        "built-in-policy",
        "用户手势已验证，允许内置导航",
      );
    }
    if (subject.vendor !== BUILTIN_VENDOR && CUSTOM_DEFAULT_DENIED.has(capability)) {
      return decision(
        capability,
        false,
        "global-deny",
        "自定义组件默认拒绝该能力（设置页可开启）",
      );
    }
    const confirmed = await this.confirmations.confirm({
      title: `授权：${capability}`,
      message: `组件 ${subject.componentType}（vendor ${subject.vendor}）请求能力 ${capability}。原因：${reason}`,
      confirmLabel: "授权",
      cancelLabel: "取消",
      danger: capability.startsWith("vault:") || capability === "command:execute",
    });
    if (!confirmed) {
      return decision(capability, false, "global-deny", "用户拒绝授权");
    }
    const grant: CapabilityGrant = {
      grantId: newUuidV4(),
      vaultId: subject.vaultId,
      documentId: subject.documentId,
      componentType: subject.componentType,
      vendor: subject.vendor,
      packageMajor: packageMajorOf(subject.packageVersion),
      capability,
      grantedAt: new Date().toISOString(),
    };
    const put = await this.grants.put(grant);
    if (!put.ok) {
      return decision(capability, false, "global-deny", "授权保存失败");
    }
    return decision(capability, true, "user-grant", "用户已授权", grant.grantId);
  }

  assert(
    subject: CapabilitySubject,
    capability: Capability,
    mode: RuntimeMode,
  ): Result<void> {
    const d = this.evaluate(subject, capability, mode);
    if (d.granted) {
      return { ok: true, value: undefined };
    }
    return {
      ok: false,
      error: {
        code: ERROR_CODES.CAPABILITY_DENIED,
        message: `能力 ${capability} 未授权：${d.reason}`,
        scope: "capability",
        recoverable: false,
        retryable: false,
        details: {
          capability,
          source: d.source,
          componentId: subject.componentId,
        } satisfies JsonObject,
      },
    };
  }

  async revoke(grantId: string): Promise<Result<void>> {
    return this.grants.revoke(grantId);
  }

  private modeDenies(capability: Capability, mode: RuntimeMode): boolean {
    if (mode === "thumbnail") {
      return true; // thumbnail 不启动 Query/Timer/Navigation/Action（协议 3.8）
    }
    if (mode === "edit" && EDIT_DENIED.has(capability)) {
      return true;
    }
    return false;
  }
}

export type { CapabilitySubject, CapabilityDecision, ComponentId };
