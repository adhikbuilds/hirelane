import { describe, expect, it } from "vitest";
import { clearSessionCookie, readCookie, serializeCookie, sessionCookie, sessionCookieName, SESSION_COOKIE } from "../lib/auth/cookies";
import { appOrigin, isSameOrigin } from "../lib/auth/origin";

const prod = { NODE_ENV: "production" };

describe("session cookie", () => {
  it("is __Host- prefixed, HttpOnly, Secure, SameSite=Lax, path / and has no Domain", () => {
    const c = sessionCookie("hl_s_abc", 3600, prod);
    expect(c.name).toBe("__Host-hl_session");
    expect(c.name).toBe(SESSION_COOKIE);
    expect(c.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600 });
    const header = serializeCookie(c);
    expect(header).toContain("__Host-hl_session=hl_s_abc");
    for (const part of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=3600"]) expect(header).toContain(part);
    expect(header).not.toMatch(/Domain=/i);
  });

  it("keeps the __Host- name on http://localhost in development (Chromium accepts it there)", () => {
    expect(sessionCookieName({ NODE_ENV: "development" })).toBe("__Host-hl_session");
  });

  it("uses the dev-only fallback name only when asked, and never in production", () => {
    expect(sessionCookieName({ NODE_ENV: "development", HIRELANE_INSECURE_DEV_COOKIE: "1" })).toBe("hl_session_dev");
    const c = sessionCookie("t", 60, { NODE_ENV: "development", HIRELANE_INSECURE_DEV_COOKIE: "1" });
    expect(c.options.secure).toBe(false);
    expect(c.options.httpOnly).toBe(true);
    expect(sessionCookieName({ NODE_ENV: "production", HIRELANE_INSECURE_DEV_COOKIE: "1" })).toBe("__Host-hl_session");
    expect(sessionCookie("t", 60, { NODE_ENV: "production", HIRELANE_INSECURE_DEV_COOKIE: "1" }).options.secure).toBe(true);
  });

  it("clears with Max-Age=0 under the same name and attributes", () => {
    const header = serializeCookie(clearSessionCookie(prod));
    expect(header).toContain("__Host-hl_session=;");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Secure");
  });

  it("refuses values that could break out of the header", () => {
    expect(() => serializeCookie({ name: "n", value: "a;b", options: { httpOnly: true, secure: true, sameSite: "lax", path: "/" } })).toThrow();
    expect(() => serializeCookie({ name: "n", value: "a\r\nSet-Cookie: x=y", options: { httpOnly: true, secure: true, sameSite: "lax", path: "/" } })).toThrow();
  });
});

describe("readCookie", () => {
  it("finds a cookie among several and ignores look-alikes", () => {
    const h = "a=1; __Host-hl_session=tok; x__Host-hl_session=evil";
    expect(readCookie(h, "__Host-hl_session")).toBe("tok");
    expect(readCookie(null, "a")).toBeNull();
    expect(readCookie("b=2", "a")).toBeNull();
  });
});

describe("origin check", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("accepts the same origin as the Host header", () => {
    expect(isSameOrigin(h({ origin: "http://localhost:3001", host: "localhost:3001" }), {})).toBe(true);
  });
  it("rejects a different origin, a different port and a missing or null origin", () => {
    expect(isSameOrigin(h({ origin: "https://evil.example.test", host: "localhost:3001" }), {})).toBe(false);
    expect(isSameOrigin(h({ origin: "http://localhost:3002", host: "localhost:3001" }), {})).toBe(false);
    expect(isSameOrigin(h({ host: "localhost:3001" }), {})).toBe(false);
    expect(isSameOrigin(h({ origin: "null", host: "localhost:3001" }), {})).toBe(false);
    expect(isSameOrigin(h({ origin: "not a url", host: "localhost:3001" }), {})).toBe(false);
  });
  it("rejects a suffix trick", () => {
    expect(isSameOrigin(h({ origin: "https://app.example.test.evil.test", host: "app.example.test" }), {})).toBe(false);
  });
  it("prefers HIRELANE_APP_ORIGIN over the Host header when configured", () => {
    const env = { HIRELANE_APP_ORIGIN: "https://hirelane.example.test" };
    expect(isSameOrigin(h({ origin: "https://hirelane.example.test", host: "internal:3001" }), env)).toBe(true);
    expect(isSameOrigin(h({ origin: "http://internal:3001", host: "internal:3001" }), env)).toBe(false);
  });
  it("derives the app origin for redirects", () => {
    expect(appOrigin({ HIRELANE_APP_ORIGIN: "https://hirelane.example.test/" }, "http://internal:3001/x")).toBe("https://hirelane.example.test");
    expect(appOrigin({}, "http://localhost:3001/auth/google/start")).toBe("http://localhost:3001");
  });
});
