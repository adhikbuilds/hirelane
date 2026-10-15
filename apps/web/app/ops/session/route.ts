import { NextResponse } from "next/server";
import { OPS_COOKIE, opsAccess } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";

/** POST a form field `token`; on a match, sets the httpOnly ops cookie and redirects to /ops/ingest. */
export async function POST(req: Request) {
  const form = await req.formData();
  const token = form.get("token");
  const given = typeof token === "string" ? token : null;
  if (opsAccess({ configured: process.env["HIRELANE_OPS_TOKEN"], header: given, cookie: null }) !== "ok") {
    return new NextResponse(null, { status: 404 });
  }
  const res = NextResponse.redirect(new URL("/ops/ingest", req.url), 303);
  res.cookies.set(OPS_COOKIE, given!, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/ops",
    maxAge: 60 * 60 * 8,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
