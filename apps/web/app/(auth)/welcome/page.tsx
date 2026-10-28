import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell, StepBars } from "@/components/account/AccountShell";
import { Alert } from "@/components/shadcn/alert";
import { Button } from "@/components/shadcn/button";
import { Card, CardDescription, CardStack, CardTitle } from "@/components/shadcn/card";
import { CheckboxField } from "@/components/shadcn/checkbox-field";
import { acceptSignup, declineSignup, getPendingSignup } from "./actions";

export const metadata: Metadata = { title: "One last step", robots: { index: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  consent_required: "Tick all three boxes to create your account.",
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
  if (r.reason === "under_18") redirect("/welcome?under18=1");
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
          <CardStack tone="pink">
            <Card aria-labelledby="u18-h">
              <CardTitle id="u18-h">Hirelane is for people 18 and over</CardTitle>
              <CardDescription>We didn&apos;t save anything about you: no account, no email, no resume.</CardDescription>
              <div className="acct-stack-y">
                <Button asChild variant="lime" size="pill">
                  <Link href="/jobs">Browse open roles</Link>
                </Button>
              </div>
            </Card>
          </CardStack>
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

        <CardStack>
          <Card aria-labelledby="welcome-h">
            <StepBars step={3} label="Sign-in progress" />
            <CardTitle id="welcome-h">Create your account</CardTitle>
            <CardDescription>
              Signing up as <strong>{pending.email}</strong>
            </CardDescription>
            {e && ERRORS[e] ? <Alert>{ERRORS[e]}</Alert> : null}
            <form action={accept} className="acct-stack-y">
              <CheckboxField name="over18" required title="I am 18 or older" description="Hirelane is for students and graduates aged 18 and over." />
              <CheckboxField
                name="terms"
                required
                title="I agree to the terms"
                description={
                  <Link href="/terms" target="_blank">
                    Read the terms
                  </Link>
                }
              />
              <CheckboxField
                name="privacy"
                required
                title="I've read the privacy notice"
                description={
                  <Link href="/privacy" target="_blank">
                    What we keep, and how to delete it
                  </Link>
                }
              />
              <Button type="submit" variant="lime" size="pill">
                Create my account
              </Button>
            </form>
            <form action={under18} className="acct-stack-y">
              <button type="submit" className="acct-linkbtn" formNoValidate>
                I&apos;m under 18
              </button>
            </form>
          </Card>
        </CardStack>
      </div>
    </AccountShell>
  );
}
