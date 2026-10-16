"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Loader2, Search, X } from "lucide-react";
import { suggestJobs } from "../../app/jobs/actions";
import { CompanyLogo } from "../brand/CompanyLogo";
import { cn } from "../ui/cn";
import { suggestItems, type SuggestItem } from "./preview-model";

const DEBOUNCE_MS = 140;

/**
 * Search with title and company type-ahead. Without JavaScript it is a plain GET form to /jobs, so the URL stays the state.
 * `carry` holds the other active filters as hidden fields; picking a title keeps them.
 */
export function SearchBox({ defaultValue, carry }: { defaultValue: string; carry: [string, string][] }) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-list`;
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<SuggestItem[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const seq = useRef(0);
  const root = useRef<HTMLFormElement>(null);

  const hrefForTitle = (title: string) => {
    const sp = new URLSearchParams(carry);
    sp.set("q", title.toLowerCase());
    return `/jobs?${sp.toString()}`;
  };

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      seq.current++;
      setItems([]);
      setPending(false);
      return;
    }
    const mine = ++seq.current;
    setPending(true);
    const t = setTimeout(() => {
      suggestJobs(q)
        .then((s) => {
          if (mine !== seq.current) return;
          setItems(suggestItems(s, hrefForTitle));
          setCursor(-1);
        })
        .catch(() => mine === seq.current && setItems([]))
        .finally(() => mine === seq.current && setPending(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);

  const go = (item: SuggestItem) => {
    setOpen(false);
    router.push(item.href);
  };
  const showList = open && value.trim().length >= 2 && (items.length > 0 || !pending);

  return (
    <form ref={root} action="/jobs" method="get" role="search" className="relative w-full" onSubmit={() => setOpen(false)}>
      <label htmlFor="board-q" className="sr-only">
        Search jobs by title or company
      </label>
      <div className="flex h-14 items-center gap-2 rounded-[16px] border border-line bg-surface pl-4 pr-2 shadow-card focus-within:border-lane focus-within:ring-4 focus-within:ring-lane/15">
        <Search aria-hidden className="size-5 shrink-0 text-ink-3" />
        <input
          id="board-q"
          name="q"
          type="text"
          inputMode="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={cursor >= 0 ? `${id}-o${cursor}` : undefined}
          value={value}
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search a title or company"
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && items.length > 0) {
              e.preventDefault();
              setOpen(true);
              setCursor((c) => (c + 1) % items.length);
            } else if (e.key === "ArrowUp" && items.length > 0) {
              e.preventDefault();
              setCursor((c) => (c <= 0 ? items.length - 1 : c - 1));
            } else if (e.key === "Enter" && showList && cursor >= 0 && items[cursor]) {
              e.preventDefault();
              go(items[cursor]!);
            } else if (e.key === "Escape") {
              if (open) {
                e.preventDefault();
                setOpen(false);
              } else (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-3 focus-visible:outline-none"
        />
        {pending ? <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-ink-3" /> : null}
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setValue("");
              setItems([]);
              document.getElementById("board-q")?.focus();
            }}
            className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-ink/5 hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : (
          <kbd aria-hidden className="hidden h-6 shrink-0 items-center rounded-md border border-line bg-canvas px-2 text-[12px] font-bold text-ink-3 sm:inline-flex">
            /
          </kbd>
        )}
        <button
          type="submit"
          className="h-10 shrink-0 rounded-[12px] bg-lane px-5 text-[15px] font-bold text-white shadow-[0_1px_2px_rgb(15_31_26/.2)] hover:bg-lane-600"
        >
          Search
        </button>
      </div>
      {carry.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <div
        id={listId}
        role="listbox"
        aria-label="Suggestions"
        hidden={!showList}
        className="absolute inset-x-0 top-full z-40 mt-2 max-h-[min(26rem,70vh)] overflow-auto rounded-[16px] border border-line bg-surface p-1.5 shadow-pop"
      >
        {items.length === 0 ? (
          <p className="px-3 py-3 text-[14px] text-ink-2">No title or company starts like that. Press Enter to search the full text.</p>
        ) : null}
        {(["company", "title"] as const).map((type) => {
          const group = items.map((it, i) => ({ it, i })).filter((x) => x.it.type === type);
          if (group.length === 0) return null;
          return (
            <div key={type} role="presentation">
              <p role="presentation" className="px-3 pb-1 pt-2 text-[12px] font-bold uppercase tracking-[0.08em] text-ink-3">
                {type === "company" ? "Companies" : "Job titles"}
              </p>
              {group.map(({ it, i }) => (
                <div
                  key={it.key}
                  id={`${id}-o${i}`}
                  role="option"
                  aria-selected={i === cursor}
                  data-suggest={it.type}
                  onMouseMove={() => setCursor(i)}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    go(it);
                  }}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2", i === cursor && "bg-lane-50")}
                >
                  {it.type === "company" ? (
                    <CompanyLogo name={it.label} src={it.logoPath} size={28} />
                  ) : (
                    <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-ink/5 text-ink-3">
                      <Briefcase className="size-3.5" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{it.label}</span>
                  <span className="figure shrink-0 text-[13px] text-ink-3">{it.meta}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </form>
  );
}
