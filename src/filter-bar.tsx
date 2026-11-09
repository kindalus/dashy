import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import type { ParamDefinition, ParamValue, Params } from "../core/types";
import { filterValue } from "../core/filters";
import { ParameterControl } from "./controls";
import { formatPeriod } from "./format";

/** A short summary of a filter value for its chip: 2020, jan 2020, 01/01/2020 – 15/03/2020 or All. */
export function chipValue(value: ParamValue | undefined, definition: ParamDefinition, locale: string): string {
  if (value && typeof value === "object" && !Array.isArray(value) && definition.valueType === "date") {
    const from = String(value.from), until = String(value.until);
    const year = from.slice(0, 4);
    if (from === `${year}-01-01` && until === `${year}-12-31`) return year;
    const month = from.slice(0, 7);
    const last = new Date(Date.UTC(Number(year), Number(from.slice(5, 7)), 0)).toISOString().slice(0, 10);
    if (from === `${month}-01` && until === last) return formatPeriod(month, "month", locale);
    const date = (text: string) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeZone: "UTC" }).format(new Date(`${text}T00:00:00Z`));
    return `${date(from)} – ${date(until)}`;
  }
  if (Array.isArray(value) && value.length > 2) return `${value.length} selected`;
  return filterValue(value, definition);
}

/**
 * One filter as a chip that opens its control in a popover. The draft changes
 * live; the form's Apply button applies every draft at once, as before.
 */
export function FilterChip(props: {
  name: string;
  definition: ParamDefinition;
  value: ParamValue | undefined;
  onChange: (value: ParamValue | undefined) => void;
  timezone: string;
  locale: string;
  context: () => Params;
}) {
  const [open, setOpen] = createSignal(false);
  const [place, setPlace] = createSignal<{ left: number; top?: number; bottom?: number }>();
  let button: HTMLButtonElement | undefined;
  let popover: HTMLDivElement | undefined;
  const id = `chip-${props.name}`;
  const active = () => filterValue(props.value, props.definition) !== "All";
  const position = () => {
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(380, innerWidth - 16);
    const below = innerHeight - rect.bottom;
    const up = below < 300 && rect.top > below;
    // The Power BI pane sits at the right edge: open towards the canvas.
    const left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
    setPlace(up ? { left, bottom: innerHeight - rect.top + 6 } : { left, top: rect.bottom + 6 });
  };
  const close = (focus = true) => {
    if (!untrack(open)) return;
    setOpen(false);
    if (focus) button?.focus();
  };
  createEffect(open, (isOpen) => {
    if (!isOpen) return;
    queueMicrotask(() => popover?.querySelector<HTMLElement>("input, button, [tabindex]")?.focus());
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!button?.contains(target) && !popover?.contains(target)) close(false);
    };
    const key = (event: KeyboardEvent) => {
      // Inner lists close themselves first and stop the event.
      if (event.key === "Escape" && !event.defaultPrevented) close();
    };
    const reflow = (event: Event) => {
      if (!(event.target instanceof Node && popover?.contains(event.target))) position();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    addEventListener("resize", reflow);
    addEventListener("scroll", reflow, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      removeEventListener("resize", reflow);
      removeEventListener("scroll", reflow, true);
    };
  });
  return (
    <div class="filter-chip-wrap">
      <button
        ref={button}
        type="button"
        class={`filter-chip${active() ? " is-set" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={id}
        title={`${props.definition.label}: ${chipValue(props.value, props.definition, props.locale)}`}
        onClick={() => { if (open()) close(); else { position(); setOpen(true); } }}
      >
        <span class="chip-flag" aria-hidden="true">--{props.name}</span>
        <span class="chip-label">{props.definition.label}</span>
        <span class="chip-value">{chipValue(props.value, props.definition, props.locale)}</span>
      </button>
      <Show when={open()}>
        <div
          ref={popover}
          id={id}
          class="chip-popover"
          role="dialog"
          aria-label={props.definition.label}
          style={{
            left: `${place()?.left ?? 0}px`,
            ...(place()?.top !== undefined ? { top: `${place()!.top}px` } : { bottom: `${place()?.bottom ?? 0}px` }),
          }}
        >
          <ParameterControl
            name={props.name}
            definition={props.definition}
            value={props.value}
            onChange={props.onChange}
            timezone={props.timezone}
            context={props.context}
          />
          <div class="chip-popover-actions">
            <button type="button" class="button text" onClick={() => props.onChange(props.definition.type === "array" ? [] : null)}>Clear</button>
            <button type="button" class="button secondary" onClick={() => close()}>Done</button>
          </div>
        </div>
      </Show>
    </div>
  );
}

/** Filters as chips (default) or as labelled fields (Cognos), with the extra filters behind one chip. */
export function FilterBar(props: {
  names: readonly string[];
  definitions: Record<string, ParamDefinition>;
  draft: Params;
  onChange: (name: string, value: ParamValue | undefined) => void;
  timezone: string;
  locale: string;
  context: () => Params;
  fields: boolean;
  visible: number;
  prompt?: string;
}) {
  const [more, setMore] = createSignal(false);
  const extra = () => props.names.slice(props.visible);
  const activeExtra = () => extra().filter((name) => filterValue(props.draft[name], props.definitions[name]!) !== "All").length;
  return (
    <>
      <Show when={props.prompt}>
        <span class="filter-prompt" aria-hidden="true"><span class="prompt-caret">❯</span> {props.prompt}</span>
      </Show>
      <For each={[...props.names]}>
        {(name, index) => (
          <div class={`filter-slot${!more() && index() >= props.visible ? " is-collapsed" : ""}`}>
            <Show
              when={props.fields}
              fallback={
                <FilterChip name={name} definition={props.definitions[name]!} value={props.draft[name]}
                  onChange={(value) => props.onChange(name, value)} timezone={props.timezone}
                  locale={props.locale} context={props.context} />
              }
            >
              <ParameterControl name={name} definition={props.definitions[name]!} value={props.draft[name]}
                onChange={(value) => props.onChange(name, value)} timezone={props.timezone} context={props.context} />
            </Show>
          </div>
        )}
      </For>
      <Show when={extra().length > 0}>
        <button type="button" class="more-filters" aria-expanded={more() ? "true" : "false"} onClick={() => setMore(!more())}>
          {more() ? "Fewer filters" : `+ ${extra().length} filter${extra().length > 1 ? "s" : ""}${activeExtra() ? ` · ${activeExtra()} set` : ""}`}
        </button>
      </Show>
    </>
  );
}
