import type { Metadata } from "next";
import { confirmUnsubscribe } from "./actions";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ t?: string | string[]; done?: string | string[] }> };

/** GET shows a confirm button and changes nothing; the button POSTs. The token is never echoed back. */
export default async function Unsubscribe({ searchParams }: Props) {
  const sp = await searchParams;
  const done = sp.done === "1";
  const t = typeof sp.t === "string" && /^[0-9a-f]{64}$/.test(sp.t) ? sp.t : null;
  return (
    <main style={{ maxWidth: 520, margin: "10vh auto", padding: 24 }}>
      {done ? (
        <>
          <h1>You are unsubscribed</h1>
          <p>We will not email you about new drives or drives closing. Important mail about your applications still arrives, and everything still shows in the app.</p>
        </>
      ) : t ? (
        <>
          <h1>Stop these emails?</h1>
          <p>This turns off email about new drives and drives closing. Mail about your applications is not affected.</p>
          <form action={confirmUnsubscribe}>
            <input type="hidden" name="t" value={t} />
            <button type="submit">Unsubscribe</button>
          </form>
        </>
      ) : (
        <>
          <h1>This link is not valid</h1>
          <p>You can change email settings inside the app.</p>
        </>
      )}
    </main>
  );
}
