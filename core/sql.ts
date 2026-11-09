import type { Scalar, SqlStatement } from "./types";
import { previousRange } from "./dates";

/** Values are always bound. Identifiers must come from application definitions. */
export function identifier(value: string): string {
  if (!value || value.includes("\0")) throw new Error("Invalid SQL identifier");
  return `"${value.replaceAll('"', '""')}"`;
}
export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
export const sql = {
  fragment(text: string, values: Scalar[] = []): SqlStatement {
    return { text, values };
  },
  eq(column: string, value: Scalar | undefined): SqlStatement {
    return value === undefined || value === null || value === ""
      ? { text: "", values: [] }
      : { text: `${column} = ?`, values: [value] };
  },
  in(column: string, values: Scalar[]): SqlStatement {
    return values.length
      ? { text: `${column} IN (${values.map(() => "?").join(", ")})`, values }
      : { text: "", values: [] };
  },
  range(
    column: string,
    value: { from: Scalar; until: Scalar } | undefined,
  ): SqlStatement {
    return value
      ? { text: `${column} BETWEEN ? AND ?`, values: [value.from, value.until] }
      : { text: "", values: [] };
  },
  /**
   * The range to compare a date range with: the same number of days just before
   * (`period`, default) or the same dates a year earlier (`year`). Undefined when
   * the range is missing or not made of dates.
   */
  previousRange,
  where(...parts: SqlStatement[]): SqlStatement {
    const active = parts.filter((p) => p.text);
    return {
      text: active.length
        ? `WHERE ${active.map((p) => `(${p.text})`).join(" AND ")}`
        : "",
      values: active.flatMap((p) => p.values),
    };
  },
};
