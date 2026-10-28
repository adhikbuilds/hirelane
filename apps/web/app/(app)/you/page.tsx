import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountShell } from "@/components/account/AccountShell";
import { getSession } from "@/lib/session";
import { deleteMyAccount, logout } from "./actions";

export const metadata: Metadata = { title: "You", robots: { index: false } };
export const dynamic = "force-dynamic";

const NEVER = [
  "Apply or send anything in your name. You press submit on the company's own site.",
  "Show your resume or marks to your college. Your placement cell only sees totals, never you.",
  "Charge you to apply, or ask for a registration fee.",
  "Sell your data or share it with employers.",
  "Keep your resume after you delete it. It's gone within 24 hours.",
];

async function signOut() {
  "use server";
  await logout(); // redirects to /signin
  redirect("/signin");
}

async function deleteAccount(formData: FormData) {
  "use server";
  const r = await deleteMyAccount({ confirm: formData.get("confirm") === "on" }); // redirects to / on success
  redirect(`/you?e=${r.reason}`);
}

function Cross() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export default async function YouPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (!(await getSession())) redirect("/signin");
  const { e } = await searchParams;

  return (
    <AccountShell
      right={
        <form action={signOut}>
          <button type="submit" className="acct-btn" data-variant="lime" style={{ minHeight: 44 }}>
            Sign out
          </button>
        </form>
      }
    >
      <div className="acct-you">
        <h1 className="acct-display">You&apos;re in.</h1>

        <section className="acct-next" aria-labelledby="next-h">
          <h2 id="next-h">Next: your resume</h2>
          <p>Soon you&apos;ll upload your resume here and see what a company&apos;s hiring software sees: what&apos;s missing, what to fix, and which roles you qualify for.</p>
        </section>

        <div className="acct-stack" data-tone="pink">
          <section className="acct-card" aria-labelledby="never-h">
            <h2 id="never-h">What Hirelane never does</h2>
            <ul className="acct-never">
              {NEVER.map((line) => (
                <li key={line}>
                  <Cross />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="acct-card" aria-labelledby="delete-h">
          <h2 id="delete-h">Delete your account</h2>
          <p className="acct-hint">This signs you out everywhere and deletes your account and everything in it. It can&apos;t be undone.</p>
          {e === "not_confirmed" ? (
            <p className="acct-alert" role="alert">
              Tick the box to confirm, then press Delete my account.
            </p>
          ) : null}
          <form action={deleteAccount} className="acct-form">
            <label className="acct-check">
              <input type="checkbox" name="confirm" />
              <div>
                <strong>Yes, delete my account</strong>
                <span>I understand this can&apos;t be undone.</span>
              </div>
            </label>
            <button type="submit" className="acct-btn" data-variant="danger">
              Delete my account
            </button>
          </form>
        </section>
      </div>
    </AccountShell>
  );
}
