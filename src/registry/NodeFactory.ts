/**
 * NodeFactory（《运行时与 SDK 协议 v1》第 2.6 节）。
 *
 * 固定顺序：
 *   1. createDefaultProps()
 *   2. 深复制默认 Props
 *   3. initialProps 作为完整替换值（不做不明确的深合并）
 *   4. Definition.validate
 *   5. enabled=true、label=null、默认 NodeStyle
 *   6. 为每个声明 Slot 创建空数组
 *   7. 空 Binding / Event / Extension
 *   8. 当前 specVersion
 *   9. 完整节点校验
 *
 * NodeFactory 不插入文档、不写文件、不发布事件。
 */

import { ERROR_CODES } from "@ocs/contracts";
import { DEFAULT_NODE_STYLE_V1 } from "@ocs/contracts";
import type {
  BindingSpecV1,
  EventSequenceV1,
  NodeStyleV1,
} from "@ocs/contracts/document";
import type {
  ComponentType,
  JsonObject,
  ProtocolError,
  Result,
  ValidationResult,
} from "@ocs/contracts/common";
import type {
  ComponentDefinition,
  ComponentNode,
  CreateComponentContext,
  NodeFactory,
  NodeFactoryInput,
  RegisteredComponentDefinition,
  SlotDefinition,
} from "./definition";
import type { ChildRef } from "../runtime/types";

const SCOPE = "node-factory" as const;

/** 泛型 P 擦除后的 Definition 视图：私有闭包在此处接管。 */
interface DefinitionView {
  readonly manifest: { readonly type: ComponentType; readonly specVersion: number };
  readonly slots: readonly SlotDefinition<object>[];
  createDefaultPropsUnknown(context: CreateComponentContext): object;
  validateUnknown(input: unknown): ValidationResult<object>;
}

function viewOf<P extends object>(definition: ComponentDefinition<P>): DefinitionView {
  return {
    manifest: definition.manifest,
    slots: definition.slots as unknown as readonly SlotDefinition<object>[],
    createDefaultPropsUnknown: (context) => definition.createDefaultProps(context),
    validateUnknown: (input) => definition.validate(input),
  };
}

export class NodeFactoryImpl implements NodeFactory {
  create<P extends object>(input: NodeFactoryInput<P>): Result<ComponentNode<P>> {
    const result = this.createNode(viewOf(input.definition), input.context, input.initialProps);
    if (!result.ok) return result;
    // 第 4 步 validate 已成功，值即为 P；此时断言合法（第 2.5 节禁止校验前断言）。
    return { ok: true, value: result.value as unknown as ComponentNode<P> };
  }

  createFromRegistered(input: {
    readonly definition: RegisteredComponentDefinition;
    readonly context: CreateComponentContext;
    readonly initialProps?: JsonObject;
  }): Result<ComponentNode<object>> {
    return this.createNode(
      {
        manifest: input.definition.manifest,
        slots: input.definition.slots,
        createDefaultPropsUnknown: input.definition.createDefaultPropsUnknown,
        validateUnknown: input.definition.validateUnknown,
      },
      input.context,
      input.initialProps,
    );
  }

  private createNode(
    view: DefinitionView,
    context: CreateComponentContext,
    initialProps: JsonObject | undefined,
  ): Result<ComponentNode<object>> {
    // 1–3. 默认 Props 深复制；initialProps 完整替换，不做深合并。
    let props: object;
    try {
      const defaults = view.createDefaultPropsUnknown(context);
      props = deepCopyJson(defaults);
      if (initialProps !== undefined) {
        props = deepCopyJson(initialProps);
      }
    } catch (err) {
      return nodeError(
        ERROR_CODES.COMPONENT_PROPS_INVALID,
        "默认 Props 必须可 JSON 序列化",
        err,
      );
    }

    // 4. Definition.validate
    const validation = view.validateUnknown(props);
    if (!validation.ok) {
      return nodeError(
        ERROR_CODES.COMPONENT_PROPS_INVALID,
        `Props 校验失败: ${validation.issues[0]?.message ?? "未知原因"}`,
      );
    }

    // 5–8. 固定字段 + 空集合 + 当前版本。
    const slots: Record<string, ChildRef[]> = {};
    for (const slot of view.slots) {
      slots[slot.name] = [];
    }
    const node: ComponentNode<object> = {
      id: context.componentId,
      type: view.manifest.type,
      specVersion: view.manifest.specVersion,
      enabled: true,
      label: null,
      props,
      style: deepCopyJson(DEFAULT_NODE_STYLE_V1),
      slots,
      bindings: [],
      events: {},
      extensions: {},
    };

    // 9. 完整节点校验：重新校验 Props + Slot 集合与声明一致。
    const recheck = view.validateUnknown(node.props);
    if (!recheck.ok) {
      return nodeError(
        ERROR_CODES.COMPONENT_PROPS_INVALID,
        `完整节点校验失败: ${recheck.issues[0]?.message ?? "未知原因"}`,
      );
    }
    const declared = new Set(view.slots.map((s) => s.name));
    const actual = Object.keys(node.slots);
    if (actual.length !== declared.size || actual.some((name) => !declared.has(name))) {
      return nodeError(
        ERROR_CODES.REGISTRY_DEFINITION_INVALID,
        "节点 Slot 集合与 Definition.slots 声明不一致",
      );
    }

    return { ok: true, value: node };
  }
}

function deepCopyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nodeError(
  code: typeof ERROR_CODES[keyof typeof ERROR_CODES],
  message: string,
  cause?: unknown,
): { ok: false; error: ProtocolError } {
  return {
    ok: false,
    error: {
      code,
      message,
      scope: SCOPE,
      recoverable: true,
      retryable: false,
      cause,
    },
  };
}

export type { BindingSpecV1, EventSequenceV1, NodeStyleV1 };
