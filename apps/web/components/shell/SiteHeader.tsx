"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "../../app/wordmark";
import { buttonClasses } from "../ui/Button";
import { cn } from "../ui/cn";
import { MobileMenu } from "./MobileMenu";
import { LandingHeader } from "../landing-v3/header";
import { isActive, NAV, START_FREE } from "./nav";

/** 64px bar. Over the landing hero it is transparent and overlaps the hero; after a little scroll, and everywhere else, it is solid with a blur. */
export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const overHero = pathname === "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // "/" gets the v3 floating bar; every other route keeps this one. (Hooks above run for both.)
  if (overHero) return <LandingHeader />;

  const solid = !overHero || scrolled;

  return (
    <header
      data-site-header
      data-solid={solid}
      className={cn(
        "sticky top-0 z-40 h-16 border-b transition-[background-color,border-color,box-shadow,backdrop-filter] duration-200",
        overHero && "-mb-16",
        solid
          ? "border-line bg-surface/85 shadow-[0_1px_0_rgb(15_31_26/.02),0_8px_24px_rgb(15_31_26/.05)] backdrop-blur-xl"
          : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-full w-full max-w-page items-center justify-between gap-6 px-4 sm:px-8">
        <Link href="/" aria-label="hirelane home" className="rounded-[8px]">
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-1 text-[15px] font-semibold">
            {NAV.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative rounded-[10px] px-3 py-2 text-ink-2 hover:bg-ink/5 hover:text-ink",
                      active && "text-ink after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-lane",
                    )}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <Link href={START_FREE.href} className={cn(buttonClasses("primary", "sm"), "hidden md:inline-flex")}>
            {START_FREE.label}
          </Link>
          <MobileMenu pathname={pathname} />
        </div>
      </div>
    </header>
  );
}
