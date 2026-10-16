"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { cn } from "./cn";

export type ComboboxOption = { value: string; label: string; hint?: string; leading?: ReactNode };

export type ComboboxProps = {
  label: string;
  options: ComboboxOption[];
  /** Selected option value, or null. */
  value: string | null;
  onChange: (value: string | null, option: ComboboxOption | null) => void;
  /** Fires on every edit so a caller can fetch suggestions; when set, `options` is shown as given (no local filtering). */
  onInputChange?: (text: string) => void;
  placeholder?: string;
  loading?: boolean;
  emptyText?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  error?: string;
  className?: string;
};

const norm = (s: string) => s.normalize("NFKD").toLowerCase();

/**
 * ARIA 1.2 combobox with a listbox popup (editable, list autocomplete).
 * Focus stays in the input; the highlighted option is exposed through aria-activedescendant.
 * Keys: Down/Up move (Down opens), Home/End jump, Enter picks, Escape closes then clears, Tab closes.
 */
export function Combobox({
  label,
  options,
  value,
  onChange,
  onInputChange,
  placeholder,
  loading,
  emptyText = "No matches",
  hideLabel,
  disabled,
  error,
  className,
}: ComboboxProps) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const listId = `${uid}-list`;
  const optId = (i: number) => `${uid}-opt-${i}`;
  const selected = options.find((o) => o.value === value) ?? null;
  const [text, setText] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [dirty, setDirty] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the field text in step with an externally changed selection.
  useEffect(() => {
    if (!dirty) setText(selected?.label ?? "");
  }, [selected?.label, dirty]);

  const shown = useMemo(() => {
    if (onInputChange || !dirty || !text.trim()) return options;
    const q = norm(text.trim());
    return options.filter((o) => norm(o.label).includes(q) || (o.hint ? norm(o.hint).includes(q) : false));
  }, [options, text, dirty, onInputChange]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setDirty(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (active >= 0) listRef.current?.querySelector(`#${CSS.escape(optId(active))}`)?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const pick = (o: ComboboxOption | null) => {
    onChange(o?.value ?? null, o);
    setText(o?.label ?? "");
    setDirty(false);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = shown.length;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setActive(n ? 0 : -1);
        } else if (n) setActive((a) => (a + 1) % n);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setActive(n ? n - 1 : -1);
        } else if (n) setActive((a) => (a <= 0 ? n - 1 : a - 1));
        break;
      case "Home":
        if (open && n) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (open && n) {
          e.preventDefault();
          setActive(n - 1);
        }
        break;
      case "Enter":
        if (open && active >= 0 && shown[active]) {
          e.preventDefault();
          pick(shown[active]!);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
          setActive(-1);
        } else if (text) {
          e.preventDefault();
          setText("");
          setDirty(false);
          onInputChange?.("");
          if (value !== null) onChange(null, null);
        }
        break;
      case "Tab":
        setOpen(false);
        setDirty(false);
        setText(selected?.label ?? "");
        break;
    }
  };

  const expanded = open;
  return (
    <div ref={rootRef} className={cn("relative flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className={cn("text-[13px] font-bold text-ink-2", hideLabel && "sr-only")}>
        {label}
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input
          id={inputId}
          role="combobox"
          type="text"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-activedescendant={expanded && active >= 0 ? optId(active) : undefined}
          aria-invalid={error ? true : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
            setOpen(true);
            setActive(0);
            onInputChange?.(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "h-11 w-full rounded-[12px] border border-line bg-surface pl-10 pr-10 text-[15px] font-semibold text-ink shadow-control",
            "placeholder:font-medium placeholder:text-ink-3 hover:border-lane/40",
            "transition-[border-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lane disabled:opacity-50",
            error && "border-miss",
          )}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3">
          {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <ChevronDown aria-hidden className={cn("size-4 transition-transform", expanded && "rotate-180")} />}
        </span>
      </div>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!expanded}
        className="absolute left-0 right-0 top-full z-30 mt-2 max-h-64 overflow-auto rounded-[14px] border border-line bg-surface p-1.5 shadow-pop"
      >
        {shown.length === 0 && (
          <li role="presentation" className="px-3 py-2.5 text-[14px] text-ink-3">
            {loading ? "Searching" : emptyText}
          </li>
        )}
        {shown.map((o, i) => (
          <li
            key={o.value}
            id={optId(i)}
            role="option"
            aria-selected={o.value === value}
            data-active={i === active || undefined}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(o)}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-[15px]",
              i === active ? "bg-lane-50 text-lane" : "text-ink",
            )}
          >
            {o.leading}
            <span className="min-w-0 flex-1 truncate font-semibold">{o.label}</span>
            {o.hint && <span className="shrink-0 text-[13px] text-ink-3">{o.hint}</span>}
            {o.value === value && <Check aria-hidden className="size-4 shrink-0 text-lane" />}
          </li>
        ))}
      </ul>
      {error && <p className="text-[13px] font-semibold text-[#b91c1c]">{error}</p>}
      <span role="status" aria-live="polite" className="sr-only">
        {expanded ? `${shown.length} suggestion${shown.length === 1 ? "" : "s"} available` : ""}
      </span>
    </div>
  );
}
