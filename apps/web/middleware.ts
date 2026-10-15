import { NextResponse, type NextRequest } from "next/server";
import { routeJobPath } from "./lib/negotiate";

/**
 * Edge middleware. Sections are independent; keep each one a guarded early return so they merge cleanly.
 *  1. Markdown negotiation for /job/{slug} (design section 6).
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  const job = routeJobPath(pathname, req.headers.get("accept"));
  switch (job.kind) {
    case "rewrite":
      return NextResponse.rewrite(new URL(job.to, req.url));
    case "notfound":
      return new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    case "html": {
      const res = NextResponse.next();
      res.headers.append("Vary", "Accept");
      res.headers.append("Link", `</job/${job.slug}.md>; rel="alternate"; type="text/markdown"`);
      return res;
    }
    default:
      return NextResponse.next();
  }
}

export const config = {
  // Other sections add their paths here (for example "/jobs" for query canonicalisation).
  matcher: ["/job/:path*", "/md/:path*"],
};
