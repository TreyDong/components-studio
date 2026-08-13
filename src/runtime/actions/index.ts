/**
 * MVP Action Handler 注册（《运行时与 SDK 协议 v1》第 8.6 节能力映射）。
 * 八个 MVP 动作全部基于 PlatformPort 子 Port 的真实实现。
 */
import type { ActionRunner } from "../action-types";
import type { PlatformPort } from "../../platform/ports";
import { createOpenFileHandler } from "./openFile";
import { createOpenUrlHandler } from "./openUrl";
import { createExecuteCommandHandler } from "./executeCommand";
import { createCreateFileHandler } from "./createFile";
import { createUpdateFrontmatterHandler } from "./updateFrontmatter";
import { createUpdateMarkdownTaskHandler } from "./updateMarkdownTask";
import { createClipboardCopyHandler } from "./clipboardCopy";
import { createShowNoticeHandler } from "./showNotice";

/**
 * 注册全部 8 个 MVP Action Handler。返回解除注册的 Disposable 列表
 * （正常流程不会调用；用于测试或插件卸载）。
 */
export function registerMvpActionHandlers(
  runner: ActionRunner,
  platform: PlatformPort,
): Array<{ dispose(): void | Promise<void> }> {
  const handlers = [
    createOpenFileHandler(platform),
    createOpenUrlHandler(platform),
    createExecuteCommandHandler(platform),
    createCreateFileHandler(platform),
    createUpdateFrontmatterHandler(platform),
    createUpdateMarkdownTaskHandler(platform),
    createClipboardCopyHandler(platform),
    createShowNoticeHandler(platform),
  ];
  const disposables: Array<{ dispose(): void | Promise<void> }> = [];
  for (const handler of handlers) {
    const r = runner.register(handler);
    if (r.ok) {
      disposables.push(r.value);
    }
  }
  return disposables;
}

export {
  openFileDefinition,
  createOpenFileHandler,
} from "./openFile";
export {
  openUrlDefinition,
  createOpenUrlHandler,
} from "./openUrl";
export {
  executeCommandDefinition,
  createExecuteCommandHandler,
} from "./executeCommand";
export {
  createFileDefinition,
  createCreateFileHandler,
} from "./createFile";
export {
  updateFrontmatterDefinition,
  createUpdateFrontmatterHandler,
} from "./updateFrontmatter";
export {
  updateMarkdownTaskDefinition,
  createUpdateMarkdownTaskHandler,
} from "./updateMarkdownTask";
export {
  clipboardCopyDefinition,
  createClipboardCopyHandler,
} from "./clipboardCopy";
export {
  showNoticeDefinition,
  createShowNoticeHandler,
} from "./showNotice";
