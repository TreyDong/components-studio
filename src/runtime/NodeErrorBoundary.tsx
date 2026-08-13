/**
 * NodeErrorBoundary（《运行时与 SDK 协议 v1》第 3.7、10.2 节）。
 *
 * reset key 包含 componentId + type + specVersion + node-content-revision：
 * Props 修复（content revision 变化）或重试后必须能退出错误状态。
 * 只隔离单个节点，绝不白屏整个页面。
 */
import { Component } from "react";
import type { ErrorInfo, JSX, ReactNode } from "react";
import type { ComponentId, ComponentType } from "@ocs/contracts";
import {
  SystemError,
  buildDiagnosticText,
  sanitizeRenderError,
} from "./system";

export interface NodeErrorBoundaryProps {
  readonly resetKey: string;
  readonly componentId: ComponentId;
  readonly type: ComponentType;
  readonly specVersion: number;
  readonly onReport: (error: { code: string; message: string }) => void;
  readonly onCopyDiagnostics: (text: string) => void;
  readonly children: ReactNode;
}

interface NodeErrorBoundaryState {
  readonly error: { code: string; message: string } | null;
  readonly attempts: number;
}

export class NodeErrorBoundary extends Component<NodeErrorBoundaryProps, NodeErrorBoundaryState> {
  override state: NodeErrorBoundaryState = { error: null, attempts: 0 };

  static getDerivedStateFromError(thrown: unknown): NodeErrorBoundaryState {
    return { error: sanitizeRenderError(thrown), attempts: 0 };
  }

  override componentDidCatch(thrown: unknown, _info: ErrorInfo): void {
    this.props.onReport(sanitizeRenderError(thrown));
  }

  private retry = (): void => {
    // 重试 = 清空错误并重新渲染子树；再次失败会被重新捕获。
    this.setState((prev) => ({ error: null, attempts: prev.attempts + 1 }));
  };

  private copyDiagnostics = (): void => {
    const error = this.state.error;
    if (!error) return;
    const text = buildDiagnosticText(error, {
      componentId: this.props.componentId,
      type: this.props.type,
      specVersion: this.props.specVersion,
      issues: null,
    });
    this.props.onCopyDiagnostics(text);
  };

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <SystemError
          code={this.state.error.code}
          message={this.state.error.message}
          componentId={this.props.componentId}
          type={this.props.type}
          specVersion={this.props.specVersion}
          issues={null}
          onRetry={this.retry}
          onCopyDiagnostics={this.copyDiagnostics}
        />
      );
    }
    return this.props.children;
  }
}

export type { JSX };
