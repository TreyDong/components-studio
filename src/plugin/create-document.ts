/**
 * DocumentFileCreatorImpl —— 文档创建流程（《运行时与 SDK 协议 v1》第 5.7 节
 * + 《技术规格 v1》第 8.0 节）。
 *
 * 创建流程固定：规范化 `.components` 路径 → 拒绝已存在文件 → 生成
 * document/root UUID 和 UTC 时间 → DocumentBuilder 创建默认 core.layout Root
 * → Codec 规范化序列化 → writeNew → 可选打开。不得覆盖同名文件。
 */

import type {
  DocumentBuilderV1,
  Result,
  UtcIsoDateTime,
} from "@ocs/contracts";
import type { DocumentCodec } from "../document/codec";
import type {
  ComponentsStoragePort,
  TextFileSnapshot,
} from "../platform/ports";

export interface DocumentCreateInput {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly openAfterCreate: boolean;
}

export interface DocumentFileCreator {
  create(input: DocumentCreateInput): Promise<Result<TextFileSnapshot>>;
}

export interface DocumentFileCreatorDeps {
  readonly storage: ComponentsStoragePort;
  readonly builder: DocumentBuilderV1;
  readonly codec: DocumentCodec;
}

export class DocumentFileCreatorImpl implements DocumentFileCreator {
  private readonly storage: ComponentsStoragePort;
  private readonly builder: DocumentBuilderV1;
  private readonly codec: DocumentCodec;

  constructor(deps: DocumentFileCreatorDeps) {
    this.storage = deps.storage;
    this.builder = deps.builder;
    this.codec = deps.codec;
  }

  async create(input: DocumentCreateInput): Promise<Result<TextFileSnapshot>> {
    const normalized = this.storage.paths.normalize(input.path);
    if (!normalized.ok) {
      return normalized;
    }
    const target = normalized.value.endsWith(".components")
      ? normalized.value
      : `${normalized.value}.components`;

    // DocumentBuilder 生成 document/root UUID 与 UTC 时间，创建默认
    // core.layout Root（dataSources/permissions/extensions 为空）。
    const built = this.builder.create({
      title: input.title,
      description: input.description,
      tags: [],
      now: new Date().toISOString() as UtcIsoDateTime,
    });
    if (!built.ok) {
      return built;
    }
    const serialized = this.codec.serialize(built.value);
    if (!serialized.ok) {
      return serialized;
    }
    // writeNewText：目标存在返回 SAVE_TARGET_EXISTS，绝不覆盖；UI 应建议新名称。
    return this.storage.writeNewText(target, serialized.value);
  }
}
