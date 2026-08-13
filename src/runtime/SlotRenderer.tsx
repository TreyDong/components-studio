/**
 * SlotRenderer（《运行时与 SDK 协议 v1》第 3.4 节）。
 * 每个节点一个实例；children 一律通过 NodeRenderer 渲染，
 * 循环检测、错误边界、Editor NodeFrame 与可见性都集中在 Runtime。
 */
import type { ElementType, JSX, ReactNode } from "react";
import type { ChildRef, SlotRenderer as SlotRendererPort } from "./types";
import type { RegisteredComponentDefinition } from "../registry/definition";
import type { ComponentNodeV1 } from "@ocs/contracts/document";

export interface CreateSlotRendererOptions {
  readonly node: ComponentNodeV1;
  readonly definition: RegisteredComponentDefinition;
  /** 渲染单个 child（由 NodeRenderer 提供，含 location/ancestry 计算）。 */
  readonly renderChildNode: (
    child: ChildRef,
    slotName: string,
    index: number,
  ) => ReactNode;
}

export function createSlotRenderer(options: CreateSlotRendererOptions): SlotRendererPort {
  const { node, definition, renderChildNode } = options;
  const slotNames = new Set(definition.slots.map((s) => s.name));
  // 文档 ChildRefV1 → 运行期 ChildRef（唯一差异是 placement.tab.icon 品牌字符串）。
  const refsBySlot = new Map<string, ChildRef[]>();
  for (const slotName of Object.keys(node.slots)) {
    refsBySlot.set(
      slotName,
      (node.slots[slotName] ?? []).map((ref) => ref as unknown as ChildRef),
    );
  }

  /** child 属于哪个 slot、在其中的下标（renderChild 无 slotName 参数）。 */
  function locate(child: ChildRef): { slotName: string; index: number } | null {
    for (const [slotName, refs] of refsBySlot) {
      const index = refs.findIndex((r) => r.nodeId === child.nodeId);
      if (index >= 0) {
        return { slotName, index };
      }
    }
    return null;
  }

  function has(slotName: string): boolean {
    return slotNames.has(slotName) && refsBySlot.has(slotName);
  }

  function getChildren(slotName: string): readonly ChildRef[] {
    return refsBySlot.get(slotName) ?? [];
  }

  function renderChild(
    child: ChildRef,
    childOptions?: { readonly className?: string },
  ): ReactNode {
    const located = locate(child);
    if (!located) return null;
    return (
      <div
        className={childOptions?.className}
        data-ocs-slot-child={child.nodeId}
        key={child.nodeId}
      >
        {renderChildNode(child, located.slotName, located.index)}
      </div>
    );
  }

  function render(
    slotName: string,
    renderOptions?: {
      readonly wrapper?: ElementType;
      readonly empty?: ReactNode;
      readonly childClassName?: string;
    },
  ): ReactNode {
    if (!has(slotName)) {
      return renderOptions?.empty ?? null;
    }
    const refs = refsBySlot.get(slotName) ?? [];
    if (refs.length === 0) {
      return renderOptions?.empty ?? null;
    }
    const content = refs.map((child) => renderChild(child, { className: renderOptions?.childClassName }));
    if (renderOptions?.wrapper) {
      const Wrapper = renderOptions.wrapper;
      return <Wrapper>{content}</Wrapper>;
    }
    return content;
  }

  return { has, getChildren, render, renderChild };
}

export type { ChildRef, JSX };
