import type { ParamDefinition, Params, ParamValue, Scalar } from "./types";

export class DashyError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "DashyError";
  }
}
const empty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
function scalar(
  name: string,
  raw: unknown,
  type: string,
  def: ParamDefinition,
): Scalar {
  if (typeof raw === "object" || typeof raw === "function")
    throw new DashyError(`Invalid value for ${name}`);
  if (type === "boolean") {
    if (raw === true || raw === "true") return true;
    if (raw === false || raw === "false") return false;
    throw new DashyError(`${name} must be true or false`);
  }
  if (type === "number") {
    if (typeof raw === "boolean" || String(raw).trim() === "")
      throw new DashyError(`${name} must be a number`);
    const n = Number(raw);
    if (!Number.isFinite(n) || (def.integer && !Number.isInteger(n)))
      throw new DashyError(
        `${name} must be ${def.integer ? "an integer" : "a number"}`,
      );
    if (
      (def.min !== undefined && n < def.min) ||
      (def.max !== undefined && n > def.max)
    )
      throw new DashyError(`${name} is outside the allowed range`);
    return n;
  }
  const text = String(raw).trim();
  if (text.length > 2000) throw new DashyError(`${name} is too long`);
  if (type === "date") {
    const date = new Date(text);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      !Number.isFinite(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== text
    )
      throw new DashyError(`${name} must be a valid YYYY-MM-DD date`);
  }
  return text;
}
export function parseParams(
  definitions: Record<string, ParamDefinition>,
  accepted: readonly string[],
  raw: Record<string, unknown>,
  defaults: Params = {},
): Params {
  for (const name of Object.keys(raw))
    if (!accepted.includes(name))
      throw new DashyError(`Unknown parameter: ${name}`);
  const result: Params = Object.create(null);
  for (const name of accepted) {
    const def = definitions[name];
    if (!def) throw new Error(`Undefined parameter: ${name}`);
    const value = Object.hasOwn(raw, name)
      ? raw[name]
      : Object.hasOwn(defaults, name)
        ? defaults[name]
        : def.default;
    if (empty(value)) {
      if (def.required) throw new DashyError(`${def.label} is required`);
      continue;
    }
    let parsed: ParamValue;
    if (def.type === "range") {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new DashyError(`${name} must have from and until`);
      const range = value as Record<string, unknown>;
      if (empty(range.from) && empty(range.until) && !def.required) continue;
      if (
        empty(range.from) ||
        empty(range.until) ||
        Object.keys(range).some((k) => !["from", "until"].includes(k))
      )
        throw new DashyError(`${name} requires from and until`);
      const from = scalar(name, range.from, def.valueType || "number", def) as
        | string
        | number;
      const until = scalar(
        name,
        range.until,
        def.valueType || "number",
        def,
      ) as string | number;
      if (from > until)
        throw new DashyError(`${name}: from must be before until`);
      parsed = { from, until };
    } else if (def.type === "array") {
      if (!Array.isArray(value) || value.length > 250)
        throw new DashyError(`${name} must be an array of at most 250 values`);
      parsed = value.map((v) =>
        scalar(name, v, def.valueType || "string", def),
      );
    } else {
      parsed = scalar(
        name,
        value,
        def.type === "select" ? def.valueType || "string" : def.type,
        def,
      );
      if (
        def.type === "select" &&
        !def.options?.some((option) => option.value === parsed)
      )
        throw new DashyError(`Invalid option for ${name}`);
    }
    if (empty(parsed)) {
      if (def.required) throw new DashyError(`${def.label} is required`);
      continue;
    }
    result[name] = parsed;
  }
  return result;
}
/** HTTP ranges use date.from/date.until; arrays use repeated query keys. */
export function readParams(
  search: URLSearchParams,
  definitions: Record<string, ParamDefinition> = {},
): Record<string, unknown> {
  const raw: Record<string, unknown> = Object.create(null);
  for (const key of new Set(search.keys())) {
    const values = search.getAll(key);
    const parts = key.split(".");
    if (parts.length === 2 && ["from", "until"].includes(parts[1]!)) {
      const name = parts[0]!;
      if (
        values.length !== 1 ||
        (raw[name] !== undefined &&
          (typeof raw[name] !== "object" || Array.isArray(raw[name])))
      )
        throw new DashyError(`Invalid range: ${name}`);
      const range = (raw[name] ??= Object.create(null)) as Record<
        string,
        unknown
      >;
      range[parts[1]!] = values[0];
    } else {
      if (raw[key] !== undefined)
        throw new DashyError(`Conflicting parameter: ${key}`);
      raw[key] =
        values.length > 1 ||
        (definitions[key]?.type === "array" && values[0] !== "")
          ? values
          : values[0];
    }
  }
  return raw;
}
export function selectParams(
  params: Record<string, unknown>,
  names: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    names
      .filter((name) => Object.hasOwn(params, name))
      .map((name) => [name, params[name]]),
  );
}
