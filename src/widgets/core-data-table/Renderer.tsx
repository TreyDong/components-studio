/**
 * core.data-table Renderer（《运行时与 SDK 协议 v1》第 9 节）。
 * 静态表格：表头（可关）、列宽 / 对齐、斑马纹、空态。
 * 单元格标量格式化：null 显示为空，boolean 渲染 ✓ / ✗。
 */

import type { ComponentRendererProps } from "../../registry/definition";
import type { DataTableProps } from "./schema";

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  return String(value);
}

export function CoreDataTableRenderer({ props }: ComponentRendererProps<DataTableProps>) {
  return (
    <section className="ocs-data-table">
      {props.title ? <h3 className="ocs-data-table-title">{props.title}</h3> : null}
      {props.rows.length === 0 ? (
        <p className="ocs-data-table-empty">{props.emptyText}</p>
      ) : (
        <div className="ocs-data-table-scroll">
          <table className={`ocs-data-table-grid${props.striped ? " striped" : ""}`}>
            {props.showHeader ? (
              <thead>
                <tr>
                  {props.columns.map((column) => (
                    <th
                      key={column.key}
                      style={{ textAlign: column.align ?? "left", width: column.width != null ? `${column.width}px` : undefined }}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {props.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {props.columns.map((column) => (
                    <td key={column.key} style={{ textAlign: column.align ?? "left" }}>
                      {formatCell(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
