"use client";

import { useId, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { FileText, UploadCloud } from "lucide-react";
import { cn } from "./cn";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export type DropRejection = "not-pdf" | "too-large" | "empty" | "multiple";

export const REJECTION_TEXT: Record<DropRejection, string> = {
  "not-pdf": "That is not a PDF. Drop your resume as a PDF file.",
  "too-large": "That file is over 10 MB. Try a smaller PDF.",
  empty: "That file is empty.",
  multiple: "Drop one resume at a time.",
};

/** A real PDF starts with "%PDF-". The extension and MIME type are only hints, so the header decides. */
export async function validatePdf(file: File): Promise<DropRejection | null> {
  if (file.size === 0) return "empty";
  if (file.size > MAX_PDF_BYTES) return "too-large";
  const hinted = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!hinted) return "not-pdf";
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    const magic = String.fromCharCode(...head);
    return magic === "%PDF-" ? null : "not-pdf";
  } catch {
    return "not-pdf";
  }
}

export type DropZoneProps = {
  /** Called with a validated PDF. The file never leaves the browser: this component has no network code. */
  onFile: (file: File) => void;
  onReject?: (reason: DropRejection) => void;
  /** Replaces the idle copy. */
  title?: string;
  hint?: ReactNode;
  compact?: boolean;
  /** The accepted file name, shown in a confirmed state. */
  accepted?: string | null;
  disabled?: boolean;
  className?: string;
};

/**
 * Resume drop zone. A real button (focusable; Enter and Space open the picker) that also takes drag and drop.
 * PDF only. It reads at most the first five bytes locally to check the header and never uploads.
 */
export function DropZone({ onFile, onReject, title = "Drop your resume here", hint, compact, accepted, disabled, className }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<DropRejection | null>(null);
  const errId = useId();
  const depth = useRef(0);

  const handle = async (files: FileList | File[] | null | undefined) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    const reject = (r: DropRejection) => {
      setError(r);
      onReject?.(r);
    };
    if (list.length > 1) return reject("multiple");
    const file = list[0]!;
    const bad = await validatePdf(file);
    if (bad) return reject(bad);
    setError(null);
    onFile(file);
  };

  const open = () => !disabled && inputRef.current?.click();
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    if (!disabled) void handle(e.dataTransfer?.files);
  };

  return (
    <div className={className}>
      <button
        type="button"
        disabled={disabled}
        onClick={open}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            open();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setOver(false);
        }}
        onDrop={onDrop}
        aria-describedby={error ? errId : undefined}
        data-over={over || undefined}
        className={cn(
          "group flex w-full flex-col items-center justify-center rounded-[16px] border-2 border-dashed text-center",
          "transition-[background-color,border-color,transform,box-shadow] duration-200 ease-out",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lane disabled:opacity-50",
          compact ? "gap-1.5 px-5 py-5" : "gap-3 px-6 py-9",
          over
            ? "scale-[1.01] border-lane bg-lane-50 shadow-card"
            : accepted
              ? "border-match bg-match/5"
              : "border-lane/35 bg-surface/70 hover:border-lane hover:bg-lane-50/70",
          error && !over && "border-miss/60",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid place-items-center rounded-full bg-lane-50 text-lane transition-transform duration-200 group-hover:-translate-y-0.5",
            compact ? "size-9" : "size-12",
          )}
        >
          {accepted ? <FileText className="size-5" /> : <UploadCloud className="size-5" />}
        </span>
        <span className={cn("font-extrabold tracking-tight text-ink", compact ? "text-[16px]" : "text-[19px]")}>
          {accepted ?? title}
        </span>
        <span className="text-[14px] text-ink-2">
          {accepted ? "Choose a different PDF" : (hint ?? "or click to choose a PDF. It stays in your browser: nothing is uploaded.")}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        tabIndex={-1}
        aria-label="Resume PDF"
        className="sr-only"
        onChange={(e) => {
          void handle(e.target.files);
          e.target.value = "";
        }}
      />
      <p id={errId} role="alert" className={cn("mt-2 text-[14px] font-semibold text-[#b91c1c]", !error && "sr-only")}>
        {error ? REJECTION_TEXT[error] : ""}
      </p>
    </div>
  );
}
