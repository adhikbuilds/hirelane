import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell, StepBars } from "@/components/account/AccountShell";
import { Alert } from "@/components/shadcn/alert";
import { Button } from "@/components/shadcn/button";
import { Card, CardDescription, CardStack, CardTitle } from "@/components/shadcn/card";
import { Input, Label } from "@/components/shadcn/input";
import { sendEmailCode } from "../actions";
import { verifyCode } from "./actions";

export const metadata: Metadata = { title: "Enter your code", robots: { index: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid_code: "That code didn't work. Check the 6 digits, or send a new code.",
  rate_limited: "Too many tries. Wait a few minutes, then try again.",
  bad_origin: "This form expired. Reload the page and try again.",
};

async function checkCode(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  const r = await verifyCode({ email, code }); // redirects on success
  redirect(`/signin/code?email=${encodeURIComponent(email)}&e=${r.reason}`);
}

async function resend(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const r = await sendEmailCode({ email });
  if (!r.ok) redirect(`/signin?e=${r.reason}`);
  redirect(`/signin/code?email=${encodeURIComponent(email)}&sent=1`);
}

export default async function CodePage({ searchParams }: { searchParams: Promise<{ email?: string; e?: string; sent?: string }> }) {
  const { email, e, sent } = await searchParams;
  if (!email) redirect("/signin");

  return (
    <AccountShell>
      <div className="acct-main">
        <section>
          <h1 className="acct-display">Check your email.</h1>
          <p className="acct-lede">The code works for 10 minutes. Can&apos;t see it? Look in Spam or Promotions.</p>
        </section>

        <CardStack>
          <Card aria-labelledby="code-h">
            <StepBars step={2} label="Sign-in progress" />
            <CardTitle id="code-h">Enter the 6-digit code</CardTitle>
            <CardDescription>
              Sent to <strong>{email}</strong>
            </CardDescription>
            {e && ERRORS[e] ? <Alert>{ERRORS[e]}</Alert> : null}
            {sent ? <Alert tone="ok">New code sent. Use the latest one.</Alert> : null}
            <form action={checkCode} className="acct-stack-y">
              <input type="hidden" name="email" value={email} />
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                name="code"
                variant="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                required
                placeholder="000000"
                aria-invalid={e === "invalid_code" ? true : undefined}
              />
              <Button type="submit" variant="lime" size="pill">
                Sign in
              </Button>
            </form>
            <form action={resend} className="acct-stack-y">
              <input type="hidden" name="email" value={email} />
              <button type="submit" className="acct-linkbtn">
                Send a new code
              </button>
            </form>
            <p className="acct-note">
              Wrong address? <Link href="/signin">Use a different email</Link>
            </p>
          </Card>
        </CardStack>
      </div>
    </AccountShell>
  );
}
