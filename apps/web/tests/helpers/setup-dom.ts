import { afterEach } from "vitest";

// Only jsdom files have a document. Give them the browser APIs jsdom lacks and clean up between tests.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => cleanup());

  class IO {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      this.cb([{ isIntersecting: true, target: el, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  if (!("IntersectionObserver" in globalThis)) Object.assign(globalThis, { IntersectionObserver: IO });
  if (!("ResizeObserver" in globalThis)) {
    Object.assign(globalThis, { ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
  }
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  Element.prototype.scrollIntoView ??= () => {};
}
