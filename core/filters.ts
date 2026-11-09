/** Browser-safe text for filter values, shared by exports, images and print. */
import type { ParamDefinition, ParamValue, Scalar } from "./types.ts";
import { messages, type Messages } from "./i18n.ts";

/** True when a filter has no value, so it narrows nothing (shown as "All"). */
export const isUnset = (value: ParamValue | undefined) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length);

/** "All" when unset; ranges as "from – until"; static options by label; booleans as Yes/No. */
export function filterValue(value: ParamValue | undefined, definition: ParamDefinition, text: Messages = messages.en): string {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return text.all;
  if (typeof value === "object" && !Array.isArray(value)) return `${value.from} – ${value.until}`;
  const labels = Array.isArray(definition.options) ? definition.options : [];
  const label = (v: Scalar) => {
    if (typeof v === "boolean") return v ? text.yes : text.no;
    const option = labels.find((o) => String(o.value) === String(v));
    return option ? String(option.label ?? option.value) : String(v);
  };
  return Array.isArray(value) ? value.map(label).join(", ") : label(value);
}

/** One line such as "Period: 2020-01-01 – 2020-12-31 · Country: All". */
export function describeFilters(
  names: readonly string[],
  values: Record<string, ParamValue | undefined>,
  params: Record<string, ParamDefinition>,
  /** Text appended in parentheses, by parameter name. */
  notes: Record<string, string> = {},
  text: Messages = messages.en,
): string {
  return names.filter((name) => params[name])
    .map((name) => `${params[name]!.label}: ${filterValue(values[name], params[name]!, text)}${notes[name] ? ` (${notes[name]})` : ""}`)
    .join(" · ");
}
