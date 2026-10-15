import type { Metadata } from "next";
import { buildOpenApi } from "../../lib/openapi";
import { appOrigin } from "../../lib/queries/jobs";

export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Public jobs API",
  description: "Read open jobs as JSON. No key, 60 requests a minute, CORS open, ETag supported.",
  alternates: { canonical: "/api-docs" },
};

type Param = { name: string; description: string; schema: { enum?: string[]; type?: string; minimum?: number; maximum?: number; default?: unknown } };

const constraint = (s: Param["schema"]): string => {
  if (s.enum) return s.enum.join(", ");
  if (s.minimum !== undefined && s.maximum !== undefined) return `integer ${s.minimum} to ${s.maximum}`;
  return s.type ?? "";
};

const ERRORS: [string, string, string][] = [
  ["400", "invalid_param", "A value is not allowed. The body names the parameter."],
  ["400", "page_out_of_range", "page is above 100."],
  ["404", "not_found", "No job with that slug."],
  ["429", "rate_limited", "Over 60 requests a minute. Wait Retry-After seconds."],
];

function Block({ children, label }: { children: string; label: string }) {
  return (
    <pre aria-label={label} className="mt-3 overflow-x-auto border border-rule bg-sheet px-4 py-3 text-[14px] leading-6 whitespace-pre font-medium">
      {children}
    </pre>
  );
}

export default function ApiDocsPage() {
  const origin = appOrigin();
  const doc = buildOpenApi(origin);
  const params = doc.paths["/api/public/jobs"].get.parameters as (Param & { in: string })[];

  return (
    <div className="mx-auto w-full max-w-page px-4 sm:px-8 py-8">
      <div className="flex items-baseline justify-between border-b-2 border-rule-strong pb-2">
        <h1 className="display text-[40px]">Public jobs API</h1>
        <p className="text-[13px] text-ink-2">
          <a href="/openapi.json" className="hover:text-lane hover:underline">
            openapi.json
          </a>
        </p>
      </div>

      <section className="border-b border-rule py-6" aria-labelledby="basics">
        <h2 id="basics" className="text-[22px] font-bold">
          Basics
        </h2>
        <ul className="mt-3 max-w-3xl space-y-1 text-ink-2">
          <li>Read only. No key and no sign-in.</li>
          <li>60 requests a minute per client. Over the limit you get 429 with a Retry-After header.</li>
          <li>Any origin may call it from a browser (GET only, no credentials).</li>
          <li>Every response has an ETag. Send it back as If-None-Match and an unchanged page returns 304 with no body.</li>
          <li>Pay is returned only when the posting states it, in integer minor units (cents, paise). Nothing is estimated.</li>
          <li>Hirelane does not submit applications. Each job links to the employer&apos;s own page.</li>
        </ul>
      </section>

      <section className="border-b border-rule py-6" aria-labelledby="list">
        <h2 id="list" className="text-[22px] font-bold">
          List jobs
        </h2>
        <p className="mt-1 text-ink-2">
          <span className="font-semibold text-ink">GET /api/public/jobs</span> returns jobs, page, pageSize, pages, total and links.
          Total is the true match count; pages is capped at 100.
        </p>
        <Block label="Example request">{`curl '${origin}/api/public/jobs?role=data-engineer&country=IN&remote=1&salary=1'`}</Block>

        <table className="mt-5 w-full text-left" data-testid="api-params">
          <thead className="text-[13px] text-ink-3">
            <tr className="border-b border-rule">
              <th className="w-36 py-2 pr-3 font-medium">Parameter</th>
              <th className="w-64 py-2 pr-3 font-medium">Values</th>
              <th className="py-2 font-medium">What it does</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.name} className="border-b border-rule align-top">
                <td className="py-2 pr-3 font-semibold">{p.name}</td>
                <td className="py-2 pr-3 text-ink-2">{constraint(p.schema)}</td>
                <td className="py-2 text-ink-2">{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 max-w-3xl text-[13px] text-ink-3">
          Each parameter takes one value. Unknown parameters are ignored. A value that is not allowed returns 400 rather than being
          dropped. The links.self value is the canonical form of your query.
        </p>
      </section>

      <section className="border-b border-rule py-6" aria-labelledby="one">
        <h2 id="one" className="text-[22px] font-bold">
          One job
        </h2>
        <p className="mt-1 text-ink-2">
          <span className="font-semibold text-ink">GET /api/public/jobs/{"{slug}"}</span> adds the description, requirements with their
          source spans, the pay trace, every source posting and closedAt for jobs that have closed.
        </p>
        <Block label="Example request">{`curl '${origin}/api/public/jobs/{slug}'`}</Block>
        <p className="mt-3 text-ink-2">
          The same job is also available as Markdown at <span className="font-semibold text-ink">/job/{"{slug}"}.md</span>.
        </p>
      </section>

      <section className="py-6" aria-labelledby="errors">
        <h2 id="errors" className="text-[22px] font-bold">
          Errors
        </h2>
        <p className="mt-1 text-ink-2">
          Errors share one shape: an error object with code, message and, where it applies, param.
        </p>
        <table className="mt-4 w-full max-w-3xl text-left" data-testid="api-errors">
          <thead className="text-[13px] text-ink-3">
            <tr className="border-b border-rule">
              <th className="w-20 py-2 pr-3 font-medium">Status</th>
              <th className="w-48 py-2 pr-3 font-medium">Code</th>
              <th className="py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {ERRORS.map(([status, code, when]) => (
              <tr key={code} className="border-b border-rule">
                <td className="figure py-2 pr-3">{status}</td>
                <td className="py-2 pr-3 font-semibold">{code}</td>
                <td className="py-2 text-ink-2">{when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
