/**
 * 最小合法 V1 文档 fixture（文档协议第 4 章完整最小示例）。
 */
import type { ComponentId, ComponentsDocumentV1, DocumentId } from "@ocs/contracts";

export const ROOT_ID = "c51f659b-e69c-4286-a0dd-f338b865e68c" as ComponentId;
export const DOC_ID = "27b57616-c2d3-4762-ad6f-fe066b072c95" as DocumentId;

export function minimalDocument(
  overrides: Partial<ComponentsDocumentV1> = {},
): ComponentsDocumentV1 {
  const base: ComponentsDocumentV1 = {
    kind: "components-studio/document",
    formatVersion: 1,
    documentId: DOC_ID,
    revision: 0,
    createdAt: "2026-08-13T09:24:31.428Z" as import("@ocs/contracts").UtcIsoDateTime,
    updatedAt: "2026-08-13T09:24:31.428Z" as import("@ocs/contracts").UtcIsoDateTime,
    rootId: ROOT_ID,
    nodes: {
      [ROOT_ID]: {
        id: ROOT_ID,
        type: "core.layout" as import("@ocs/contracts").ComponentType,
        specVersion: 1,
        enabled: true,
        label: "根布局",
        props: {
          mode: "stack",
          gap: 12,
          padding: 0,
          locked: false,
          grid: {
            columns: { compact: 1, regular: 6, wide: 12 },
            rowHeight: 80,
            dense: false,
            allowOverlap: false,
          },
          columns: { wrap: true, equalWidth: false },
          tabs: { activation: "automatic", placement: "top" },
        },
        style: {
          visibility: "visible",
          classNames: [],
          width: "auto",
          minHeightPx: null,
          paddingPx: { top: 0, right: 0, bottom: 0, left: 0 },
          marginPx: { top: 0, right: 0, bottom: 0, left: 0 },
          background: null,
          color: null,
          border: null,
          shadow: "none",
        },
        slots: { children: [] },
        bindings: [],
        events: {},
        extensions: {},
      },
    },
    dataSources: {},
    permissions: { requested: [] },
    metadata: {
      title: "主页",
      description: "个人动态主页",
      tags: ["dashboard"],
    },
    extensions: {},
  };
  return { ...base, ...overrides };
}

export function minimalDocumentText(): string {
  return JSON.stringify(minimalDocument(), null, 2) + "\n";
}
