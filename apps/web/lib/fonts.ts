import localFont from "next/font/local";

// Self-hosted variable fonts (copied from @fontsource-variable 5.3.0, OFL-1.1; licences in app/fonts) so builds never
// fetch from Google Fonts. Latin subset only: glyphs outside it fall back to the next font in each font-family stack.

export const geist = localFont({
  src: [{ path: "../app/fonts/geist-latin-wght-normal.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-geist",
  display: "swap",
});

export const geistMono = localFont({
  src: [{ path: "../app/fonts/geist-mono-latin-wght-normal.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-geist-mono",
  display: "swap",
});

export const bricolage = localFont({
  src: [{ path: "../app/fonts/bricolage-grotesque-latin-wght-normal.woff2", weight: "200 800", style: "normal" }],
  variable: "--font-bricolage",
  display: "swap",
});

export const publicSans = localFont({
  src: [{ path: "../app/fonts/public-sans-latin-wght-normal.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-public",
  display: "swap",
});
