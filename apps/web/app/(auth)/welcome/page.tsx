import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell, StepBars } from "@/components/account/AccountShell";
import { acceptSignup, declineSignup, getPendingSignup } from "./actions";

export const metadata: Metadata = { title: "One last step", robots: { index: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  consent_required: "Tick all three boxes to create your account.",
  expired: "This sign-up timed out. Sign in again to start over.",
  bad_origin: "This form expired. Reload the page and try again.",
};

async function accept(formData: FormData) {
  "use server";
  const r = await acceptSignup({
    over18: formData.get("over18") === "on",
    terms: formData.get("terms") === "on",
    privacy: formData.get("privacy") === "on",
  }); // redirects to /you on success
  if (r.reason === "expired") redirect("/signin?e=expired");
  redirect(`/welcome?e=${r.reason}`);
}

async function under18() {
  "use server";
  await declineSignup();
  redirect("/welcome?under18=1");
}

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ e?: string; under18?: string }> }) {
  const { e, under18 } = await searchParams;

  if (under18) {
    return (
      <AccountShell>
        <div className="acct-main">
          <section>
            <h1 className="acct-display">Come back at 18.</h1>
          </section>
          <div className="acct-stack" data-tone="pink">
            <div className="acct-card">
              <h2>Hirelane is for people 18 and over</h2>
              <p>We didn&apos;t save anything about you: no account, no email, no resume.</p>
              <div className="acct-row">
                <Link className="acct-btn" href="/jobs">
                  Browse open roles
                </Link>
              </div>
            </div>
          </div>
        </div>
      </AccountShell>
    );
  }

  const pending = await getPendingSignup();
  if (!pending) redirect("/signin");

  return (
    <AccountShell>
      <div className="acct-main">
        <section>
          <h1 className="acct-display">One last step.</h1>
          <p className="acct-lede">Three quick checks, then you&apos;re in.</p>
        </section>

        <div className="acct-stack">
          <div className="acct-card">
            <StepBars step={3} label="Sign-in progress" />
            <h2>Create your account</h2>
            <p className="acct-hint">
              Signing up as <strong>{pending.email}</strong>
            </p>
            {e && ERRORS[e] ? (
              <p className="acct-alert" role="alert">
                {ERRORS[e]}
              </p>
            ) : null}
            <form action={accept} className="acct-form">
              <label className="acct-check">
                <input type="checkbox" name="over18" required />
                <div>
                  <strong>I am 18 or older</strong>
                  <span>Hirelane is for students and graduates aged 18 and over.</span>
                </div>
              </label>
              <label className="acct-check">
                <input type="checkbox" name="terms" required />
                <div>
                  <strong>I agree to the terms</strong>
                  <span>
                    <Link href="/terms" target="_blank">
                      Read the terms
                    </Link>
                  </span>
                </div>
              </label>
              <label className="acct-check">
                <input type="checkbox" name="privacy" required />
                <div>
                  <strong>I&apos;ve read the privacy notice</strong>
                  <span>
                    <Link href="/privacy" target="_blank">
                      What we keep, and how to delete it
                    </Link>
                  </span>
                </div>
              </label>
              <button type="submit" className="acct-btn" data-variant="lime">
                Create my account
              </button>
            </form>
            <form action={under18} className="acct-form">
              <button type="submit" className="acct-linkbtn" formNoValidate>
                I&apos;m under 18
              </button>
            </form>
          </div>
        </div>
      </div>
    </AccountShell>
  );
}
