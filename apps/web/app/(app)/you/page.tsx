import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountShell } from "@/components/account/AccountShell";
import { Alert } from "@/components/shadcn/alert";
import { Button } from "@/components/shadcn/button";
import { Card, CardDescription, CardStack, CardTitle } from "@/components/shadcn/card";
import { CheckboxField } from "@/components/shadcn/checkbox-field";
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
          <Button type="submit" variant="on-night" size="pill-sm">
            Sign out
          </Button>
        </form>
      }
    >
      <div className="acct-you">
        <h1 className="acct-display">You&apos;re in.</h1>

        <Card tone="blue" aria-labelledby="next-h">
          <CardTitle id="next-h">Next: your resume</CardTitle>
          <p className="mt-2 leading-snug">
            Soon you&apos;ll upload your resume here and see what a company&apos;s hiring software sees: what&apos;s missing, what to fix, and which roles you
            qualify for.
          </p>
        </Card>

        <CardStack tone="pink">
          <Card aria-labelledby="never-h">
            <CardTitle id="never-h">What Hirelane never does</CardTitle>
            <ul className="acct-never">
              {NEVER.map((line) => (
                <li key={line}>
                  <Cross />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Card>
        </CardStack>

        <Card aria-labelledby="delete-h">
          <CardTitle id="delete-h">Delete your account</CardTitle>
          <CardDescription>This signs you out everywhere and deletes your account and everything in it. It can&apos;t be undone.</CardDescription>
          {e === "not_confirmed" ? <Alert>Tick the box to confirm, then press Delete my account.</Alert> : null}
          <form action={deleteAccount} className="acct-stack-y">
            <CheckboxField name="confirm" title="Yes, delete my account" description="I understand this can't be undone." />
            <Button type="submit" variant="danger" size="pill">
              Delete my account
            </Button>
          </form>
        </Card>
      </div>
    </AccountShell>
  );
}
