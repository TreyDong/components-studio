/**
 * DocumentBuilder（《文档与会话协议 v1》第 5.3 节）。
 *
 * create()：
 *   1. 生成新 DocumentId 和 Root ComponentId
 *   2. 通过 NodeFactory 创建 core.layout Root
 *   3. revision=0
 *   4. createdAt=updatedAt=input.now
 *   5. dataSources={}、permissions.requested=[]、extensions={}
 *   6. 使用输入 Metadata
 *   7. 完整 Codec 校验后才返回
 *
 * clone()：
 *   - 使用调用方提供的新 DocumentId
 *   - 保持所有 Component/DataSource/Binding/Action ID
 *   - revision=0、createdAt=updatedAt=now
 */

import type {
  ChildRefV1,
  ComponentNodeV1,
  ComponentsDocumentV1,
  CreateDocumentInputV1,
  DeepReadonly,
  DocumentBuilderV1,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import type {
  ComponentType,
  DocumentId,
  JsonObject,
  ProtocolError,
  Result,
  UtcIsoDateTime,
  ValidationIssue,
} from "@ocs/contracts/common";
import { defaultIdFactory, newComponentId, newDocumentId } from "../shared/id";
import type { CreateComponentContext, ComponentNode, NodeFactory } from "../registry/definition";
import type { ComponentRegistry } from "../registry/ComponentRegistry";
import type { DocumentCodec } from "./codec";

const ROOT_TYPE = "core.layout" as ComponentType;
const SCOPE = "document" as const;

export interface DocumentBuilderDeps {
  readonly registry: ComponentRegistry;
  readonly nodeFactory: NodeFactory;
  readonly codec: DocumentCodec;
}

export class DocumentBuilderImpl implements DocumentBuilderV1 {
  constructor(private readonly deps: DocumentBuilderDeps) {}

  create(input: CreateDocumentInputV1): Result<ComponentsDocumentV1> {
    const documentId = newDocumentId();
    const rootId = newComponentId();

    const rootDefinition = this.deps.registry.get(ROOT_TYPE);
    if (!rootDefinition) {
      return {
        ok: false,
        error: this.error(
          ERROR_CODES.COMPONENT_TYPE_UNKNOWN,
          `缺少 ${ROOT_TYPE} 定义，无法创建根节点`,
        ),
      };
    }

    const context: CreateComponentContext = {
      documentId,
      componentId: rootId,
      parentId: null,
      sourcePath: "",
      locale: "system",
      createdAt: input.now,
      ids: defaultIdFactory,
      companions: {},
    };
    const created = this.deps.nodeFactory.createFromRegistered({
      definition: rootDefinition,
      context,
    });
    if (!created.ok) return created;

    const document: ComponentsDocumentV1 = {
      kind: "components-studio/document",
      formatVersion: 1,
      documentId,
      revision: 0,
      createdAt: input.now,
      updatedAt: input.now,
      rootId,
      nodes: { [rootId]: toPersistedNode(created.value) },
      dataSources: {},
      permissions: { requested: [] },
      metadata: {
        title: input.title,
        description: input.description,
        tags: Array.from(input.tags),
      },
      extensions: {},
    };

    // 7. 完整校验后才返回。
    const validation = this.deps.codec.validate(document);
    if (!validation.ok) {
      return {
        ok: false,
        error: this.error(
          ERROR_CODES.DOC_SCHEMA_INVALID,
          "创建文档校验失败",
          { pointer: validation.issues[0]?.pointer ?? "" },
        ),
      };
    }
    return { ok: true, value: document };
  }

  clone(
    source: DeepReadonly<ComponentsDocumentV1>,
    input: { documentId: DocumentId; now: UtcIsoDateTime },
  ): Result<ComponentsDocumentV1> {
    let cloned: ComponentsDocumentV1;
    try {
      cloned = JSON.parse(JSON.stringify(source)) as ComponentsDocumentV1;
    } catch (err) {
      return {
        ok: false,
        error: this.error(ERROR_CODES.DOC_SCHEMA_INVALID, "克隆文档序列化失败", undefined, err),
      };
    }
    cloned.documentId = input.documentId;
    cloned.revision = 0;
    cloned.createdAt = input.now;
    cloned.updatedAt = input.now;

    const validation = this.deps.codec.validate(cloned);
    if (!validation.ok) {
      return {
        ok: false,
        error: this.error(
          ERROR_CODES.DOC_SCHEMA_INVALID,
          "克隆文档校验失败",
          { pointer: validation.issues[0]?.pointer ?? "" },
        ),
      };
    }
    return { ok: true, value: cloned };
  }

  private error(
    code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
    message: string,
    details?: JsonObject,
    cause?: unknown,
  ): ProtocolError {
    return {
      code,
      message,
      scope: SCOPE,
      recoverable: true,
      retryable: false,
      details,
      cause,
    };
  }
}

/** RegisteredComponentDefinition 的节点 → 持久 ComponentNodeV1。 */
function toPersistedNode(node: ComponentNode<object>): ComponentNodeV1 {
  const slots: Record<string, ChildRefV1[]> = {};
  for (const [name, refs] of Object.entries(node.slots)) {
    slots[name] = refs.map((ref) => ({
      nodeId: ref.nodeId,
      placement: ref.placement,
    }));
  }
  return {
    id: node.id,
    type: node.type,
    specVersion: node.specVersion,
    enabled: node.enabled,
    label: node.label,
    // 已通过 Definition.validate（additionalProperties:false 的对象 Schema），必为 JSON 对象。
    props: node.props as JsonObject,
    style: node.style,
    slots,
    bindings: [...node.bindings],
    events: node.events,
    extensions: node.extensions,
  };
}

export type { ValidationIssue };
