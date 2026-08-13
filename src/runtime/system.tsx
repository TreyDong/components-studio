/**
 * Runtime 系统占位组件（《运行时与 SDK 协议 v1》第 10 章）。
 * `system.unknown`：Registry 找不到 type 或未来 specVersion 的 fallback。
 * `system.error`：NodeErrorBoundary fallback，不写入文档。
 */
import type { JSX } from "react";
import type { ComponentId, ComponentType, ProtocolError, ValidationIssue } from "@ocs/contracts";

export interface SystemUnknownProps {
  readonly componentId: ComponentId;
  readonly type: ComponentType;
  readonly specVersion: number;
  readonly supportedSpecVersion: number | null;
  /** edit 模式下可选中（data-component-type 包装由 NodeFrame 提供）。 */
  readonly editable: boolean;
}

/**
 * 显示组件 type、specVersion、componentId 与“缺少对应组件实现”。
 * View 只显示简洁占位；原始 JSON 由文档保留，不做任何规范化。
 */
export function SystemUnknown(props: SystemUnknownProps): JSX.Element {
  const versionLabel =
    props.supportedSpecVersion === null
      ? `${props.specVersion}`
      : `${props.specVersion}（运行时支持 ${props.supportedSpecVersion}）`;
  return (
    <div
      data-system="system.unknown"
      data-component-type={props.type}
      data-component-id={props.componentId}
      data-component-editable={props.editable}
      className="ocs-system-unknown"
      role="note"
    >
      <div className="ocs-system-unknown-label">缺少对应组件实现</div>
      <div className="ocs-system-unknown-meta">
        type: {props.type} · specVersion: {versionLabel} · id: {props.componentId}
      </div>
    </div>
  );
}

export interface SystemErrorProps {
  readonly code: string;
  readonly message: string;
  readonly componentId: ComponentId | null;
  readonly type: ComponentType | null;
  readonly specVersion: number | null;
  readonly issues: readonly ValidationIssue[] | null;
  readonly onRetry?: () => void;
  readonly onCopyDiagnostics?: () => void;
}

/**
 * 节点级错误 fallback。View 不显示调用栈、本机绝对路径或正文；
 * 只显示错误码与脱敏消息。重试与复制脱敏诊断由边界提供回调。
 */
export function SystemError(props: SystemErrorProps): JSX.Element {
  return (
    <div
      data-system="system.error"
      data-component-type={props.type ?? undefined}
      data-component-id={props.componentId ?? undefined}
      className="ocs-system-error"
      role="alert"
    >
      <div className="ocs-system-error-code">{props.code}</div>
      <div className="ocs-system-error-message">{props.message}</div>
      {props.onRetry && (
        <button
          type="button"
          className="ocs-system-error-retry"
          onClick={() => props.onRetry?.()}
        >
          重试
        </button>
      )}
      {props.onCopyDiagnostics && (
        <button
          type="button"
          className="ocs-system-error-copy"
          onClick={() => props.onCopyDiagnostics?.()}
        >
          复制诊断
        </button>
      )}
    </div>
  );
}

export interface SanitizedRenderError {
  readonly code: string;
  readonly message: string;
}

/** 从任意 thrown 值提取脱敏 ProtocolError（不泄露 stack/绝对路径）。 */
export function sanitizeRenderError(thrown: unknown): SanitizedRenderError {
  if (thrown !== null && typeof thrown === "object") {
    const candidate = thrown as Record<string, unknown>;
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return { code: candidate.code, message: candidate.message };
    }
  }
  if (thrown instanceof Error) {
    return { code: "COMPONENT_RENDER_FAILED", message: thrown.message };
  }
  return { code: "COMPONENT_RENDER_FAILED", message: "渲染器抛出未知错误" };
}

/** 复制脱敏诊断的文本（不含 stack / 绝对路径 / 文件正文）。 */
export function buildDiagnosticText(
  error: SanitizedRenderError,
  info: {
    componentId: ComponentId | null;
    type: ComponentType | null;
    specVersion: number | null;
    issues: readonly ValidationIssue[] | null;
  },
): string {
  return JSON.stringify(
    {
      code: error.code,
      message: error.message,
      componentId: info.componentId,
      type: info.type,
      specVersion: info.specVersion,
      issues: info.issues,
    },
    null,
    2,
  );
}

export type { ProtocolError };
