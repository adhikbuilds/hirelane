"use server";

import { redirect } from "next/navigation";
import { unsubscribeByToken } from "@hirelane/services";

/**
 * POST only (a form submit), so a link scanner that merely GETs the mail's link cannot switch anything off. The answer is
 * the same for a good and a bad token.
 */
export async function confirmUnsubscribe(form: FormData): Promise<void> {
  const t = form.get("t");
  await unsubscribeByToken(typeof t === "string" ? t : "");
  redirect("/unsubscribe?done=1");
}
