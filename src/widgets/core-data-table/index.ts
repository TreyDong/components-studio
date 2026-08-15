/**
 * core.data-table 组件定义入口。
 */

import { defineComponent } from "../../registry/defineComponent";
import type { ComponentDefinition } from "../../registry/definition";
import { coreDataTableManifest } from "./manifest";
import {
  dataTablePropsSchema,
  dataTableDefaultProps,
  validateDataTableProps,
} from "./schema";
import type { DataTableProps } from "./schema";
import { coreDataTableMigrations } from "./migrations";
import { CoreDataTableRenderer } from "./Renderer";

export const coreDataTableDefinition: ComponentDefinition<DataTableProps> = defineComponent({
  manifest: coreDataTableManifest,
  propsSchema: dataTablePropsSchema,
  slots: [],
  events: [],
  bindableTargets: [],
  migrations: coreDataTableMigrations,
  createCompanionDataSources: () => [],
  createDefaultProps: () => dataTableDefaultProps(),
  validate: validateDataTableProps,
  Renderer: CoreDataTableRenderer,
  Inspector: null,
});

export type { DataTableProps, DataTableColumn, TableCellAlign } from "./schema";
export { dataTablePropsSchema, dataTableDefaultProps, coreDataTableManifest, coreDataTableMigrations };
