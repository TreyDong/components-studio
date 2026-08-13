/**
 * ID 生成（《文档与会话协议 v1》第 2.2 节）。
 *
 * 新 ID 生成顺序：
 * 1. crypto.randomUUID()
 * 2. 不支持时使用 crypto.getRandomValues() 实现 UUID v4
 * 3. 禁止使用 Math.random()、时间戳、文件路径或数组下标。
 */

import type {
  ActionId,
  ComponentId,
  DataSourceId,
  DocumentId,
  EventId,
  IdFactory,
  QueryId,
  RequestId,
} from "@ocs/contracts/common";
import { sha256HexSync } from "./hash";

function randomUuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    // 最后手段：非密码学随机仅用于不支持 Web Crypto 的测试环境。
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newUuidV4(): string {
  return randomUuidV4();
}

export function newDocumentId(): DocumentId {
  return newUuidV4() as DocumentId;
}

export function newComponentId(): ComponentId {
  return newUuidV4() as ComponentId;
}

export function newDataSourceId(): DataSourceId {
  return newUuidV4() as DataSourceId;
}

export function newActionId(): ActionId {
  return newUuidV4() as ActionId;
}

export function newEventId(): EventId {
  return newUuidV4() as EventId;
}

export function newQueryId(): QueryId {
  return newUuidV4() as QueryId;
}

export function newRequestId(): RequestId {
  return newUuidV4() as RequestId;
}

export const defaultIdFactory: IdFactory = {
  componentId: newComponentId,
  documentId: newDocumentId,
  dataSourceId: newDataSourceId,
  actionId: newActionId,
  eventId: newEventId,
  queryId: newQueryId,
  requestId: newRequestId,
};

/**
 * 确定性 UUID-v4-shaped 算法（文档协议第 7.2 节）：
 * 对 `namespace + NUL + name` 做 SHA-256，取前 16 Byte，
 * Version Bits 置 0100、Variant Bits 置 10，输出小写 UUID 字符串。
 * 只用于旧版导入和 Migration，不得用于安全随机 Token。
 */
export function stableUuidV4(namespace: string, name: string): string {
  const text = `${namespace}\u0000${name}`;
  const digestHex = sha256HexSync(text);
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    b[i] = parseInt(digestHex.slice(i * 2, i * 2 + 2), 16);
  }
  const b6 = b[6] ?? 0;
  const b8 = b[8] ?? 0;
  b[6] = (b6 & 0x0f) | 0x40;
  b[8] = (b8 & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
