import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { resolveRelativeRange, todayIn } from "../core/dates";
import type { ParamDefinition, ParamOption, ParamValue, Params, QueryParamOptions, Scalar } from "../core/types";
import { appendParam } from "./actions";
import { Select } from "./select";

export interface ControlProps {
  name: string;
  definition: ParamDefinition;
  value: ParamValue | undefined;
  onChange: (value: ParamValue | undefined) => void;
  timezone: string;
  /** Current filters, sent to options queries that depend on them. */
  context: () => Params;
}
interface Option { value: Scalar; label: Scalar }

const isQueryOptions = (def: ParamDefinition): def is ParamDefinition & { options: QueryParamOptions } =>
  Boolean(def.options) && !Array.isArray(def.options);
const toList = (value: ParamValue | undefined): Scalar[] =>
  Array.isArray(value) ? value : value === undefined || value === null || value === "" || typeof value === "object" ? [] : [value];
const key = (value: Scalar) => String(value ?? "");

/** Options for query-backed parameters: list, search or resolve labels. */
export async function fetchOptions(
  name: string,
  request: { search?: string; values?: Scalar[]; context?: Params },
  signal?: AbortSignal,
): Promise<{ options: Option[]; truncated: boolean }> {
  const search = new URLSearchParams();
  for (const [param, value] of Object.entries(request.context ?? {}))
    if (param !== name) appendParam(search, param, value);
  if (request.search) search.set("_q", request.search);
  for (const value of request.values ?? []) search.append("_value", key(value));
  const response = await fetch(`/api/params/${encodeURIComponent(name)}/options?${search}`, { signal, credentials: "same-origin" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load options");
  return body;
}

export function ParameterControl(props: ControlProps) {
  const def = () => props.definition;
  const id = () => `param-${props.name}`;
  const kind = createMemo(() => {
    const d = def();
    if (d.type === "range") return "range";
    if (d.type === "boolean") return "boolean";
    if (isQueryOptions(d)) return d.options.search ? "autocomplete" : d.type === "array" ? "multi" : "select";
    if (Array.isArray(d.options) && d.options.length) return d.type === "array" ? "multi" : "select";
    if (d.type === "array") return "list";
    return "input";
  });
  return (
    <div class={`filter-field ${kind() === "range" ? "range-field" : ""} ${kind() === "multi" || kind() === "autocomplete" ? "wide-field" : ""}`}>
      <Show when={kind() === "range"} fallback={<label for={id()}>{def().label}</label>}>
        <span class="filter-label" id={`${id()}-label`}>{def().label}</span>
      </Show>
      {(() => {
        switch (kind()) {
          case "range": return <RangeControl {...props} />;
          case "boolean": return (
            <Select id={id()} value={key(props.value as Scalar ?? "")} required={def().required}
              options={[...(def().required ? [] : [{ value: "", label: "All" }]), { value: "true", label: "Yes" }, { value: "false", label: "No" }]}
              placeholder="Select…"
              onChange={(value) => props.onChange(value === "" ? null : value === "true")} />
          );
          case "select": return <SelectControl {...props} id={id()} />;
          case "multi": return <MultiSelectControl {...props} id={id()} />;
          case "autocomplete": return <AutocompleteControl {...props} id={id()} />;
          case "list": return (
            <input id={id()} type="text" autocomplete="off" placeholder={def().placeholder ?? "Comma-separated values"}
              value={toList(props.value).join(", ")}
              onChange={(e) => props.onChange(e.currentTarget.value.split(",").map((v) => v.trim()).filter(Boolean))} />
          );
          default: {
            const type = def().type === "number" ? "number" : def().type === "date" ? "date" : "text";
            return (
              <input id={id()} type={type} autocomplete="off" placeholder={def().placeholder}
                value={key((props.value ?? "") as Scalar)} min={def().min} max={def().max} step={def().integer ? 1 : "any"}
                required={def().required}
                onChange={(e) => props.onChange(e.currentTarget.value === "" ? null : e.currentTarget.value)} />
            );
          }
        }
      })()}
    </div>
  );
}

function useQueryOptions(props: ControlProps) {
  const [options, setOptions] = createSignal<Option[]>(untrack(() => isQueryOptions(props.definition)
    ? []
    : ((props.definition.options ?? []) as readonly ParamOption[]).map((o) => ({ value: o.value, label: o.label }))));
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  // Query options may depend on other filters; static options never refetch.
  const others = () => {
    const { [props.name]: _own, ...rest } = props.context();
    return rest;
  };
  createEffect(() => (isQueryOptions(props.definition) ? JSON.stringify(others()) : ""), (context) => {
    if (!context) return;
    const controller = new AbortController();
    setLoading(true);
    fetchOptions(props.name, { context: JSON.parse(context) }, controller.signal)
      .then((result) => { setOptions(result.options); setError(""); })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load options"); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  });
  return { options, error, loading };
}

function SelectControl(props: ControlProps & { id: string }) {
  const { options, error, loading } = useQueryOptions(props);
  // Required parameters have no "All" choice; an empty value shows the placeholder.
  const choices = createMemo(() => [
    ...(props.definition.required ? [] : [{ value: "", label: "All" }]),
    ...options().map((option) => ({ value: key(option.value), label: String(option.label ?? option.value) })),
  ]);
  return (
    <>
      <Select id={props.id} value={key((props.value ?? "") as Scalar)} options={choices()} loading={loading()}
        required={props.definition.required} invalid={Boolean(error())}
        placeholder={props.definition.placeholder ?? (props.value === undefined || props.value === null || props.value === "" ? "Select…" : String(props.value))}
        onChange={(raw) => {
          const option = options().find((o) => key(o.value) === raw);
          props.onChange(raw === "" ? null : option ? option.value : raw);
        }} />
      <Show when={error()}><span class="field-error">{error()}</span></Show>
    </>
  );
}

/** Close a popover on outside pointer events and Escape. */
function dismissable(element: () => HTMLElement | undefined, open: () => boolean, close: () => void) {
  const pointer = (event: PointerEvent) => {
    if (open() && !element()?.contains(event.target as Node)) close();
  };
  const keydown = (event: KeyboardEvent) => {
    if (open() && event.key === "Escape") close();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", keydown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", keydown);
    });
  }
}

function MultiSelectControl(props: ControlProps & { id: string }) {
  const { options, error, loading } = useQueryOptions(props);
  const [open, setOpen] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  let root: HTMLDivElement | undefined;
  dismissable(() => root, open, () => setOpen(false));
  const selected = () => new Set(toList(props.value).map(key));
  const summary = () => {
    const values = toList(props.value);
    if (!values.length) return "All";
    const labels = values.map((v) => String(options().find((o) => key(o.value) === key(v))?.label ?? v));
    return labels.length <= 2 ? labels.join(", ") : `${labels.length} selected`;
  };
  const visible = () => {
    const term = filter().trim().toLowerCase();
    return term ? options().filter((o) => String(o.label ?? o.value).toLowerCase().includes(term)) : options();
  };
  const toggle = (option: Option) => {
    const values = toList(props.value);
    props.onChange(selected().has(key(option.value))
      ? values.filter((v) => key(v) !== key(option.value))
      : [...values, option.value]);
  };
  return (
    <div class="multi-select" ref={root}>
      <button type="button" id={props.id} class="select-button" aria-haspopup="listbox" aria-expanded={open() ? "true" : "false"}
        aria-controls={`${props.id}-list`} onClick={() => setOpen(!open())}>
        <span>{summary()}</span><span aria-hidden="true" class="caret">▾</span>
      </button>
      <Show when={open()}>
        <div class="popover" role="dialog" aria-label={props.definition.label}>
          <Show when={options().length > 8}>
            <input type="search" class="popover-search" placeholder="Filter options" aria-label={`Filter ${props.definition.label}`}
              value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
          </Show>
          <ul id={`${props.id}-list`} role="listbox" aria-multiselectable="true" class="option-list">
            <Show when={loading()}><li class="option-note">Loading…</li></Show>
            <Show when={!loading() && !visible().length}><li class="option-note">No options</li></Show>
            <For each={visible()}>
              {(option) => (
                <li role="option" aria-selected={selected().has(key(option.value)) ? "true" : "false"}>
                  <label><input type="checkbox" checked={selected().has(key(option.value))} onChange={() => toggle(option)} />
                    <span>{String(option.label ?? option.value)}</span></label>
                </li>
              )}
            </For>
          </ul>
          <div class="popover-actions">
            <button type="button" class="button text" onClick={() => props.onChange([])}>Clear</button>
            <button type="button" class="button secondary" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      </Show>
      <Show when={error()}><span class="field-error">{error()}</span></Show>
    </div>
  );
}

function AutocompleteControl(props: ControlProps & { id: string }) {
  const multiple = () => props.definition.type === "array";
  const [labels, setLabels] = createSignal(new Map<string, string>());
  const [term, setTerm] = createSignal("");
  const [results, setResults] = createSignal<Option[]>([]);
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const [error, setError] = createSignal("");
  let root: HTMLDivElement | undefined;
  dismissable(() => root, open, () => setOpen(false));
  const values = () => toList(props.value);
  const labelOf = (value: Scalar) => labels().get(key(value)) ?? key(value);
  const remember = (options: Option[]) => {
    const next = new Map(labels());
    for (const option of options) next.set(key(option.value), String(option.label ?? option.value));
    setLabels(next);
  };
  // Resolve labels for values that arrive from the URL or a cross-filter.
  createEffect(() => ({ values: values(), context: props.context() }), ({ values: current, context }) => {
    const known = untrack(labels);
    const unknown = current.filter((v) => !known.has(key(v)));
    if (!unknown.length) return;
    const controller = new AbortController();
    fetchOptions(props.name, { values: unknown, context }, controller.signal)
      .then((result) => remember(result.options)).catch(() => {});
    return () => controller.abort();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  onCleanup(() => { clearTimeout(timer); controller?.abort(); });
  const search = (text: string) => {
    setTerm(text);
    clearTimeout(timer);
    controller?.abort();
    if (!multiple() && !text) props.onChange(null);
    timer = setTimeout(() => {
      controller = new AbortController();
      const signal = controller.signal;
      fetchOptions(props.name, { search: text, context: props.context() }, signal)
        .then((result) => { setResults(result.options); remember(result.options); setActive(result.options.length ? 0 : -1); setOpen(true); setError(""); })
        .catch((e) => { if (!signal.aborted) setError(e instanceof Error ? e.message : "Unable to search"); });
    }, 200);
  };
  const choose = (option: Option) => {
    remember([option]);
    if (multiple()) {
      if (!values().some((v) => key(v) === key(option.value))) props.onChange([...values(), option.value]);
      setTerm("");
    } else {
      props.onChange(option.value);
      setTerm("");
    }
    setOpen(false);
  };
  const keydown = (event: KeyboardEvent) => {
    const list = results();
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive(Math.min(active() + 1, list.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(Math.max(active() - 1, 0)); }
    else if (event.key === "Enter" && open() && list[active()]) { event.preventDefault(); choose(list[active()]!); }
    else if (event.key === "Backspace" && multiple() && !term() && values().length) props.onChange(values().slice(0, -1));
  };
  return (
    <div class="autocomplete" ref={root}>
      <div class="chip-input">
        <Show when={multiple()}>
          <For each={values()}>
            {(value) => (
              <span class="chip">{labelOf(value)}
                <button type="button" aria-label={`Remove ${labelOf(value)}`} onClick={() => props.onChange(values().filter((v) => key(v) !== key(value)))}>×</button>
              </span>
            )}
          </For>
        </Show>
        <input id={props.id} type="text" role="combobox" autocomplete="off" aria-autocomplete="list"
          aria-expanded={open() ? "true" : "false"} aria-controls={`${props.id}-list`}
          aria-activedescendant={open() && active() >= 0 ? `${props.id}-option-${active()}` : undefined}
          placeholder={props.definition.placeholder ?? (multiple() && values().length ? "" : "Search…")}
          value={term() || (!multiple() && values().length ? labelOf(values()[0]!) : "")}
          onInput={(e) => search(e.currentTarget.value)}
          onFocus={(e) => { if (!results().length) search(multiple() || !values().length ? "" : e.currentTarget.value); else setOpen(true); }}
          onKeyDown={keydown} />
      </div>
      <Show when={open()}>
        <ul id={`${props.id}-list`} role="listbox" class="popover option-list">
          <Show when={!results().length}><li class="option-note">No matches</li></Show>
          <For each={results()}>
            {(option, index) => (
              <li id={`${props.id}-option-${index()}`} role="option" aria-selected={active() === index() ? "true" : "false"}
                class={active() === index() ? "is-active" : ""}
                onPointerDown={(e) => { e.preventDefault(); choose(option); }}>
                {String(option.label ?? option.value)}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={error()}><span class="field-error">{error()}</span></Show>
    </div>
  );
}

const presets = [
  { id: "ytd", label: "Year to date", range: { relative: "ytd" as const } },
  { id: "mtd", label: "Month to date", range: { relative: "mtd" as const } },
  { id: "last-closed-month", label: "Last closed month", range: { relative: "last-closed-month" as const } },
  { id: "last-30", label: "Last 30 days", range: { relative: "last-days" as const, days: 30 } },
  { id: "last-12m", label: "Last 12 months", range: { relative: "last-months" as const, months: 12 } },
  { id: "last-closed-year", label: "Last closed year", range: { relative: "last-closed-year" as const } },
];

function RangeControl(props: ControlProps) {
  const def = () => props.definition;
  const isDate = () => def().valueType === "date";
  const inputType = () => (isDate() ? "date" : def().valueType === "number" ? "number" : "text");
  const range = () => (props.value && typeof props.value === "object" && !Array.isArray(props.value) ? props.value : undefined);
  const preset = () => {
    const current = range();
    if (!current || !isDate()) return "";
    const today = todayIn(props.timezone);
    return presets.find((p) => {
      const r = resolveRelativeRange(p.range, today);
      return r.from === current.from && r.until === current.until;
    })?.id ?? "";
  };
  const set = (end: "from" | "until", raw: string) => {
    const current = range() ?? { from: "", until: "" };
    const next = { ...current, [end]: raw };
    props.onChange(next.from === "" && next.until === "" ? null : next as ParamValue);
  };
  return (
    <div class="range-inputs" role="group" aria-labelledby={`param-${props.name}-label`}>
      <Show when={isDate()}>
        <Select label={`${def().label} preset`} class="range-preset" value={preset()}
          options={[{ value: "", label: "Custom" }, ...presets.map((p) => ({ value: p.id, label: p.label }))]}
          onChange={(value) => {
            const chosen = presets.find((p) => p.id === value);
            if (chosen) props.onChange(resolveRelativeRange(chosen.range, todayIn(props.timezone)));
          }} />
      </Show>
      <input aria-label={`${def().label} from`} autocomplete="off" type={inputType()} value={key((range()?.from ?? "") as Scalar)}
        required={def().required} min={def().min} max={def().max} step={def().integer ? 1 : "any"}
        onChange={(e) => set("from", e.currentTarget.value)} />
      <span aria-hidden="true">to</span>
      <input aria-label={`${def().label} until`} autocomplete="off" type={inputType()} value={key((range()?.until ?? "") as Scalar)}
        required={def().required} min={def().min} max={def().max} step={def().integer ? 1 : "any"}
        onChange={(e) => set("until", e.currentTarget.value)} />
    </div>
  );
}
