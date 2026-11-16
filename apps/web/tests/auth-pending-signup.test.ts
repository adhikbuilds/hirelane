import { generateMasterKey, EnvKeyProvider } from "@hirelane/vault";
import { describe, expect, it } from "vitest";
import { PENDING_TTL_MS, createPendingSignup, readPendingSignup } from "../lib/auth/pending-signup";
import { signPayload, verifyPayload } from "../lib/auth/session";

const keys = () => new EnvKeyProvider({ HIRELANE_MASTER_KEY: generateMasterKey() });
const T0 = new Date("2030-01-01T10:00:00Z");
const who = { provider: "email_otp" as const, subject: "subject-hmac", email: "pending@example.test" };

describe("signed payloads", () => {
  it("round-trips and binds to a purpose", async () => {
    const k = keys();
    const v = await signPayload(k, "p1", { a: 1 });
    expect(await verifyPayload(k, "p1", v)).toEqual({ a: 1 });
    expect(await verifyPayload(k, "p2", v)).toBeNull();
  });
  it("rejects a flipped byte, a swapped body and a different key", async () => {
    const k = keys();
    const v = await signPayload(k, "p", { a: 1 });
    const [body, sig] = v.split(".");
    expect(await verifyPayload(k, "p", `${body}x.${sig}`)).toBeNull();
    const other = await signPayload(k, "p", { a: 2 });
    expect(await verifyPayload(k, "p", `${other.split(".")[0]}.${sig}`)).toBeNull();
    expect(await verifyPayload(keys(), "p", v)).toBeNull();
    for (const junk of ["", "x", "a.b.c", ".", "..", "e30."]) expect(await verifyPayload(k, "p", junk)).toBeNull();
  });
});

describe("pending signup cookie value", () => {
  it("is valid for 15 minutes", async () => {
    const k = keys();
    expect(PENDING_TTL_MS).toBe(15 * 60 * 1000);
    const v = await createPendingSignup(k, who, T0);
    expect(await readPendingSignup(k, v, new Date(T0.getTime() + PENDING_TTL_MS - 1000))).toMatchObject(who);
    expect(await readPendingSignup(k, v, new Date(T0.getTime() + PENDING_TTL_MS + 1000))).toBeNull();
  });
  it("is not valid before it was issued (clock games)", async () => {
    const k = keys();
    const v = await createPendingSignup(k, who, T0);
    expect(await readPendingSignup(k, v, new Date(T0.getTime() - 3600_000))).toBeNull();
  });
  it("refuses a forged value", async () => {
    const k = keys();
    const forged = await signPayload(keys(), "auth/pending-signup", { v: 1, ...who, exp: T0.getTime() + 1000 });
    expect(await readPendingSignup(k, forged, T0)).toBeNull();
    expect(await readPendingSignup(k, undefined, T0)).toBeNull();
  });
  it("refuses a well-signed payload with the wrong shape", async () => {
    const k = keys();
    const v = await signPayload(k, "auth/pending-signup", { v: 1, provider: "password", subject: "s", email: "a@example.test", exp: T0.getTime() + 1000 });
    expect(await readPendingSignup(k, v, T0)).toBeNull();
  });
});
