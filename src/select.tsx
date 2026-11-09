import { createEffect, createMemo, createSignal, createUniqueId, For, onCleanup, Show, untrack } from "solid-js";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Themed single-choice list, following the WAI-ARIA "select-only combobox"
 * pattern: a button with role combobox owns a listbox. Keyboard: arrows, Home,
 * End, PageUp/PageDown, Enter/Space to choose, Escape to close, and typing to
 * jump to an option. Long lists (more than eight options) add a filter field.
 * The list is fixed-positioned so scrolling panels and cards never clip it.
 */
export function Select(props: {
  id?: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name when no <label for> points at `id`. */
  label?: string;
  labelledBy?: string;
  /** Shown when the value matches no option. */
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  loading?: boolean;
  class?: string;
}) {
  // createUniqueId matches between server rendering and hydration.
  const uid = untrack(() => props.id) ?? `select-${createUniqueId()}`;
  const listId = `${uid}-list`;
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const [filter, setFilter] = createSignal("");
  const [place, setPlace] = createSignal<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>();
  let button: HTMLButtonElement | undefined;
  let popover: HTMLDivElement | undefined;
  let search: HTMLInputElement | undefined;

  const searchable = () => props.options.length > 8;
  const visible = createMemo(() => {
    const term = filter().trim().toLowerCase();
    return term ? props.options.filter((o) => o.label.toLowerCase().includes(term)) : props.options;
  });
  const current = () => props.options.find((o) => o.value === props.value);
  const optionId = (index: number) => `${uid}-option-${index}`;

  const position = () => {
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    // Open upwards only when the space below is short and there is more above (e.g. a sidebar footer).
    const up = below < 240 && above > below;
    setPlace({
      left: Math.max(8, Math.min(rect.left, innerWidth - Math.max(rect.width, 180) - 8)),
      width: rect.width,
      maxHeight: Math.max(120, Math.min(320, up ? above : below)),
      ...(up ? { bottom: innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  };
  const show = (index = Math.max(0, visible().findIndex((o) => o.value === props.value))) => {
    if (props.disabled || open()) return;
    setFilter("");
    position();
    setOpen(true);
    setActive(Math.min(index, visible().length - 1));
  };
  const hide = (focus = true) => {
    if (!open()) return;
    setOpen(false);
    if (focus) button?.focus();
  };
  const choose = (option: SelectOption | undefined) => {
    if (!option) return;
    hide();
    if (option.value !== props.value) props.onChange(option.value);
  };

  // Typing jumps to the next option starting with the typed text, as native selects do.
  let typed = "";
  let typedAt = 0;
  /** Returns the matching index; signal writes are batched, so callers must not re-read `active`. */
  const typeahead = (char: string, from: number): number => {
    const now = Date.now();
    typed = now - typedAt > 700 ? char : typed + char;
    typedAt = now;
    const list = visible();
    const start = typed.length === 1 ? from + 1 : Math.max(from, 0);
    for (let step = 0; step < list.length; step++) {
      const index = (start + step) % list.length;
      if (list[index]!.label.toLowerCase().startsWith(typed.toLowerCase())) {
        setActive(index);
        return index;
      }
    }
    return from;
  };

  const keydown = (event: KeyboardEvent, fromSearch = false) => {
    const list = visible();
    const last = list.length - 1;
    const move = (index: number) => { event.preventDefault(); setActive(Math.max(0, Math.min(last, index))); };
    if (!open()) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); show(); }
      else if (event.key === "Home") { event.preventDefault(); show(0); }
      else if (event.key === "End") { event.preventDefault(); show(last); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Closed: typing selects directly, like a native select, starting after the current value.
        const option = list[typeahead(event.key, list.findIndex((o) => o.value === props.value))];
        if (option && option.value !== props.value) props.onChange(option.value);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown": return move(active() + 1);
      case "ArrowUp": return event.altKey ? (event.preventDefault(), choose(list[active()])) : move(active() - 1);
      case "Home": return fromSearch ? undefined : move(0);
      case "End": return fromSearch ? undefined : move(last);
      case "PageDown": return move(active() + 10);
      case "PageUp": return move(active() - 10);
      case "Enter": event.preventDefault(); return choose(list[active()]);
      case "Escape": event.preventDefault(); event.stopPropagation(); return hide();
      case "Tab": return hide(false);
      case " ":
        if (fromSearch) return;
        event.preventDefault();
        return choose(list[active()]);
      default:
        if (!fromSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) typeahead(event.key, active());
    }
  };

  // While open: keep the active option visible, follow scrolling and resizing, close on outside clicks.
  createEffect(() => (open() ? active() : -2), (index) => {
    if (index < 0) return;
    popover?.querySelector(`#${CSS.escape(optionId(index))}`)?.scrollIntoView({ block: "nearest" });
  });
  createEffect(open, (isOpen) => {
    if (!isOpen) return;
    if (searchable()) queueMicrotask(() => search?.focus());
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!button?.contains(target) && !popover?.contains(target)) hide(false);
    };
    const reflow = (event: Event) => {
      if (popover && event.target instanceof Node && popover.contains(event.target)) return;
      position();
    };
    document.addEventListener("pointerdown", outside);
    addEventListener("resize", reflow);
    addEventListener("scroll", reflow, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      removeEventListener("resize", reflow);
      removeEventListener("scroll", reflow, true);
    };
  });
  // A filter change keeps the first match active.
  createEffect(filter, () => { if (untrack(open)) setActive(visible().length ? 0 : -1); });
  onCleanup(() => setOpen(false));

  return (
    <div class={`select${props.class ? ` ${props.class}` : ""}`}>
      <button
        ref={button}
        id={uid}
        type="button"
        class="select-button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={listId}
        aria-activedescendant={open() && !searchable() && active() >= 0 ? optionId(active()) : undefined}
        aria-label={props.label}
        aria-labelledby={props.labelledBy}
        aria-invalid={props.invalid ? "true" : undefined}
        aria-required={props.required ? "true" : undefined}
        disabled={props.disabled}
        onClick={() => (open() ? hide() : show())}
        onKeyDown={(event) => keydown(event)}
      >
        <span class={current() ? "" : "select-placeholder"}>{current()?.label ?? props.placeholder ?? ""}</span>
        <span aria-hidden="true" class="caret">▾</span>
      </button>
      <Show when={open()}>
        <div
          ref={popover}
          class="popover select-popover"
          style={{
            left: `${place()?.left ?? 0}px`,
            "min-width": `${place()?.width ?? 0}px`,
            ...(place()?.top !== undefined ? { top: `${place()!.top}px` } : { bottom: `${place()?.bottom ?? 0}px` }),
          }}
        >
          <Show when={searchable()}>
            <input
              ref={search}
              type="search"
              class="popover-search"
              placeholder="Filter options"
              aria-label="Filter options"
              aria-controls={listId}
              aria-activedescendant={active() >= 0 ? optionId(active()) : undefined}
              value={filter()}
              onInput={(event) => setFilter(event.currentTarget.value)}
              onKeyDown={(event) => keydown(event, true)}
            />
          </Show>
          <ul id={listId} role="listbox" class="option-list" aria-labelledby={props.labelledBy ?? uid}
            style={{ "max-height": `${(place()?.maxHeight ?? 320) - (searchable() ? 48 : 0)}px` }}>
            <Show when={props.loading}><li class="option-note">Loading…</li></Show>
            <Show when={!props.loading && !visible().length}><li class="option-note">No options</li></Show>
            <For each={visible()}>
              {(option, index) => (
                <li
                  id={optionId(index())}
                  role="option"
                  aria-selected={option.value === props.value ? "true" : "false"}
                  class={`${active() === index() ? "is-active" : ""} ${option.value === props.value ? "is-selected" : ""}`.trim()}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => setActive(index())}
                  onClick={() => choose(option)}
                >
                  <span class="check" aria-hidden="true">{option.value === props.value ? "✓" : ""}</span>
                  {option.label}
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
}
