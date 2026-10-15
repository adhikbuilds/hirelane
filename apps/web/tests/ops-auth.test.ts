import { describe, expect, it } from "vitest";
import { opsAccess } from "../lib/ops-auth";

describe("opsAccess", () => {
  it("hides the page when no token is configured", () => {
    expect(opsAccess({ configured: undefined, header: "x", cookie: "x" })).toBe("hidden");
    expect(opsAccess({ configured: "", header: "", cookie: "" })).toBe("hidden");
  });
  it("accepts the token from the header or the session cookie", () => {
    expect(opsAccess({ configured: "s3cret", header: "s3cret", cookie: null })).toBe("ok");
    expect(opsAccess({ configured: "s3cret", header: null, cookie: "s3cret" })).toBe("ok");
  });
  it("hides the page for a missing or wrong token", () => {
    expect(opsAccess({ configured: "s3cret", header: null, cookie: null })).toBe("hidden");
    expect(opsAccess({ configured: "s3cret", header: "s3cre", cookie: null })).toBe("hidden");
    expect(opsAccess({ configured: "s3cret", header: "s3cret!", cookie: null })).toBe("hidden");
  });
  it("needs one exact match, not a combination", () => {
    expect(opsAccess({ configured: "a", header: "b", cookie: "b" })).toBe("hidden");
  });
});
