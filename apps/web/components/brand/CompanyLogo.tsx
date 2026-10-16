"use client";

import { useEffect, useRef, useState } from "react";
import { hueFor, initialsFor, safeLogo } from "./logo-hue";

export type CompanyLogoProps = {
  name: string;
  /** `companies.logo_path` from the Phase 2 logo store, or null. */
  src?: string | null;
  size?: number;
  className?: string;
};

/**
 * Company mark: the stored logo on a white tile, or a monogram tile in a hue hashed from the name.
 * A logo that fails to load (404, blocked, corrupt) swaps to the monogram, so there is never a broken image.
 */
export function CompanyLogo({ name, src, size = 40, className }: CompanyLogoProps) {
  const safe = safeLogo(src);
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => setFailed(false), [safe]);
  // An image can fail before React attaches onError during hydration.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, [safe]);

  const radius = Math.round(size * 0.26);
  const box = { width: size, height: size, borderRadius: radius } as const;

  if (safe && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={img}
        src={safe}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        data-logo="image"
        className={`shrink-0 border border-line bg-white object-contain ${className ?? ""}`}
        style={{ ...box, padding: Math.round(size * 0.12) }}
      />
    );
  }
  const hue = hueFor(name);
  return (
    <span
      aria-hidden="true"
      data-logo="monogram"
      className={`inline-grid shrink-0 select-none place-items-center font-extrabold tracking-tight ${className ?? ""}`}
      style={{
        ...box,
        fontSize: size * 0.4,
        background: `linear-gradient(145deg, hsl(${hue} 80% 94%), hsl(${hue} 70% 86%))`,
        color: `hsl(${hue} 60% 24%)`,
        boxShadow: `inset 0 0 0 1px hsl(${hue} 55% 78%)`,
      }}
    >
      {initialsFor(name)}
    </span>
  );
}
