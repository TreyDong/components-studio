/**
 * Capability 协议（《运行时与 SDK 协议 v1》第 8.1 节）。
 */

import type {
  ComponentId,
  ComponentType,
  DocumentId,
  ISODateTime,
  Result,
  VaultId,
} from "@ocs/contracts";
import type { ActionTrigger } from "./action-types";
import type { RuntimeMode } from "./types";

export type Capability =
  | "vault:read"
  | "vault:create"
  | "vault:modify"
  | "workspace:navigate"
  | "command:execute"
  | "clipboard:write"
  | "external-url:open"
  | "query:read"
  | "timer:use"
  | "network:request";

export interface CapabilitySubject {
  readonly vaultId: VaultId;
  readonly documentId: DocumentId;
  readonly componentId: ComponentId;
  readonly componentType: ComponentType;
  readonly vendor: string;
  readonly packageVersion: string;
}

export type CapabilityDecisionSource =
  | "built-in-policy"
  | "user-grant"
  | "global-deny"
  | "document-not-requested"
  | "definition-not-declared"
  | "runtime-mode-deny"
  | "mvp-deny";

export interface CapabilityDecision {
  readonly capability: Capability;
  readonly granted: boolean;
  readonly source: CapabilityDecisionSource;
  readonly reason: string;
  readonly grantId?: string;
}

export interface CapabilityGrant {
  readonly grantId: string;
  readonly vaultId: VaultId;
  readonly documentId: DocumentId;
  readonly componentType: ComponentType;
  readonly vendor: string;
  readonly packageMajor: number;
  readonly capability: Capability;
  readonly grantedAt: ISODateTime;
}

export interface CapabilityGrantStore {
  list(): readonly CapabilityGrant[];
  put(grant: CapabilityGrant): Promise<Result<void>>;
  revoke(grantId: string): Promise<Result<void>>;
  revokeForDocument(vaultId: VaultId, documentId: DocumentId): Promise<Result<void>>;
}

export interface CapabilityBroker {
  evaluate(
    subject: CapabilitySubject,
    capability: Capability,
    mode: RuntimeMode,
  ): CapabilityDecision;
  requestGrant(input: {
    readonly subject: CapabilitySubject;
    readonly capability: Capability;
    readonly reason: string;
    readonly mode: RuntimeMode;
    readonly trigger: ActionTrigger;
  }): Promise<CapabilityDecision>;
  assert(
    subject: CapabilitySubject,
    capability: Capability,
    mode: RuntimeMode,
  ): Result<void>;
  revoke(grantId: string): Promise<Result<void>>;
}
