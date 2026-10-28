import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell, StepBars } from "@/components/account/AccountShell";
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

        <div className="acct-stack">
          <div className="acct-card">
            <StepBars step={2} label="Sign-in progress" />
            <h2>Enter the 6-digit code</h2>
            <p className="acct-hint">
              Sent to <strong>{email}</strong>
            </p>
            {e && ERRORS[e] ? (
              <p className="acct-alert" role="alert">
                {ERRORS[e]}
              </p>
            ) : null}
            {sent ? (
              <p className="acct-alert" data-tone="ok" role="status">
                New code sent. Use the latest one.
              </p>
            ) : null}
            <form action={checkCode} className="acct-form">
              <input type="hidden" name="email" value={email} />
              <label className="acct-label" htmlFor="code">
                Code
              </label>
              <input
                id="code"
                name="code"
                className="acct-input"
                data-code=""
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                required
                placeholder="000000"
              />
              <button type="submit" className="acct-btn" data-variant="lime">
                Sign in
              </button>
            </form>
            <form action={resend} className="acct-form">
              <input type="hidden" name="email" value={email} />
              <button type="submit" className="acct-linkbtn">
                Send a new code
              </button>
            </form>
            <p className="acct-hint">
              Wrong address? <Link href="/signin">Use a different email</Link>
            </p>
          </div>
        </div>
      </div>
    </AccountShell>
  );
}
