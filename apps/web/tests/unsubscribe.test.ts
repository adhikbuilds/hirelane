import { beforeEach, describe, expect, it, vi } from "vitest";

const unsubscribeByToken = vi.hoisted(() => vi.fn(async (_t: unknown) => ({ unsubscribed: true as const })));
vi.mock("@hirelane/services", () => ({ unsubscribeByToken }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { confirmUnsubscribe } from "../app/unsubscribe/actions";
import Unsubscribe from "../app/unsubscribe/page";

const TOKEN = "a".repeat(64);
beforeEach(() => unsubscribeByToken.mockClear());

describe("/unsubscribe", () => {
  it("rendering the page (a GET, e.g. a link scanner) unsubscribes nobody", async () => {
    await Unsubscribe({ searchParams: Promise.resolve({ t: TOKEN }) });
    expect(unsubscribeByToken).not.toHaveBeenCalled();
  });
  it("the form POST calls the service with the token and lands on the done page", async () => {
    const f = new FormData();
    f.set("t", TOKEN);
    await expect(confirmUnsubscribe(f)).rejects.toThrow("NEXT_REDIRECT:/unsubscribe?done=1");
    expect(unsubscribeByToken).toHaveBeenCalledWith(TOKEN);
  });
  it("a missing token still gets the same answer and passes nothing usable", async () => {
    await expect(confirmUnsubscribe(new FormData())).rejects.toThrow("NEXT_REDIRECT:/unsubscribe?done=1");
    expect(unsubscribeByToken).toHaveBeenCalledWith("");
  });
  it("a malformed token shows the invalid page, not a button", async () => {
    const el = (await Unsubscribe({ searchParams: Promise.resolve({ t: "zzz" }) })) as { props: { children: unknown } };
    expect(JSON.stringify(el)).toContain("This link is not valid");
  });
});
