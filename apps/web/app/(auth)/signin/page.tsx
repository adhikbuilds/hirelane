import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell, GoogleMark, StepBars } from "@/components/account/AccountShell";
import { accountsEnabled } from "@/lib/auth/flags";
import { getSession } from "@/lib/session";
import { sendEmailCode } from "./actions";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid_email: "That doesn't look like an email address. Check it and try again.",
  rate_limited: "Too many codes asked for. Wait a few minutes, then try again.",
  unavailable: "We can't send codes right now. Try again in a few minutes, or continue with Google.",
  bad_origin: "This form expired. Reload the page and try again.",
  google: "Google sign-in didn't finish. Try again, or use your email instead.",
};

async function requestCode(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const r = await sendEmailCode({ email });
  if (!r.ok) redirect(`/signin?e=${r.reason}`);
  redirect(`/signin/code?email=${encodeURIComponent(email)}`);
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await getSession()) redirect("/you");
  const { e } = await searchParams;
  const open = await accountsEnabled();

  return (
    <AccountShell>
      <div className="acct-main">
        <section>
          <h1 className="acct-display">Find jobs you can actually get.</h1>
          <p className="acct-lede">
            Check your resume, see which roles you qualify for and why, and apply on the company&apos;s own site.
          </p>
        </section>

        <div className="acct-stack">
          <div className="acct-card">
            {open ? (
              <>
                <StepBars step={1} label="Sign-in progress" />
                <h2>Sign in</h2>
                <p className="acct-hint">New here? Signing in creates your account.</p>
                {e && ERRORS[e] ? (
                  <p className="acct-alert" role="alert">
                    {ERRORS[e]}
                  </p>
                ) : null}
                <div className="acct-form">
                  <a className="acct-btn" href="/auth/google/start">
                    <GoogleMark />
                    Continue with Google
                  </a>
                </div>
                <p className="acct-or">or use your email</p>
                <form action={requestCode} className="acct-form">
                  <label className="acct-label" htmlFor="email">
                    Email address
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    className="acct-input"
                    placeholder="you@gmail.com"
                  />
                  <button type="submit" className="acct-btn" data-variant="lime">
                    Send me a code
                  </button>
                </form>
                <p className="acct-hint">Opened this from Instagram or WhatsApp? Use your email. Google sign-in doesn&apos;t work inside those apps.</p>
              </>
            ) : (
              <>
                <h2>Accounts open soon</h2>
                <p>We&apos;re finishing the last checks before anyone can sign up. Join the waitlist and we&apos;ll email you once.</p>
                <div className="acct-row">
                  <Link className="acct-btn" data-variant="lime" href="/#waitlist">
                    Join the waitlist
                  </Link>
                  <Link className="acct-btn" data-variant="outline" href="/jobs">
                    Browse open roles
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AccountShell>
  );
}
