import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell, GoogleMark, StepBars } from "@/components/account/AccountShell";
import { Alert } from "@/components/shadcn/alert";
import { Button } from "@/components/shadcn/button";
import { Card, CardDescription, CardStack, CardTitle } from "@/components/shadcn/card";
import { Input, Label } from "@/components/shadcn/input";
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
  expired: "Your sign-up timed out. Sign in again to start over.",
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
          <p className="acct-lede">Check your resume, see which roles you qualify for and why, and apply on the company&apos;s own site.</p>
        </section>

        <CardStack>
          <Card aria-labelledby="signin-h">
            {open ? (
              <>
                <StepBars step={1} label="Sign-in progress" />
                <CardTitle id="signin-h">Sign in</CardTitle>
                <CardDescription>New here? Signing in creates your account.</CardDescription>
                {e && ERRORS[e] ? <Alert>{ERRORS[e]}</Alert> : null}
                <form action={requestCode} className="acct-stack-y">
                  <Label htmlFor="email">Email address</Label>
                  <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required placeholder="you@gmail.com" />
                  <Button type="submit" variant="lime" size="pill">
                    Send me a code
                  </Button>
                </form>
                <p className="acct-or">or</p>
                <div className="acct-stack-y">
                  <Button asChild variant="outline" size="pill">
                    <a href="/auth/google/start">
                      <GoogleMark />
                      Continue with Google
                    </a>
                  </Button>
                </div>
                <p className="acct-note">Opened this from Instagram or WhatsApp? Use your email. Google sign-in doesn&apos;t work inside those apps.</p>
              </>
            ) : (
              <>
                <CardTitle id="signin-h">Accounts open soon</CardTitle>
                <CardDescription>We&apos;re finishing the last checks before anyone can sign up. Join the waitlist and we&apos;ll email you once.</CardDescription>
                <div className="acct-stack-y">
                  <Button asChild variant="lime" size="pill">
                    <Link href="/#waitlist">Join the waitlist</Link>
                  </Button>
                  <Button asChild variant="outline" size="pill">
                    <Link href="/jobs">Browse open roles</Link>
                  </Button>
                </div>
              </>
            )}
          </Card>
        </CardStack>
      </div>
    </AccountShell>
  );
}
