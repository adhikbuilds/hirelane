/** /llms.txt body (llmstxt.org shape). Parameter names come from API_PARAM_ORDER so they cannot drift from the API. */
import { API_PARAM_ORDER } from "./public-api-params";

type ParamName = (typeof API_PARAM_ORDER)[number];

export const PARAM_DOCS: Record<ParamName, string> = {
  q: "free text over title, company and skills; up to 4 words, 100 characters",
  role: "role family slug, for example data-engineer",
  country: "ISO 3166-1 alpha-2 code, for example IN; the job must name this country",
  remote: "1 to return remote jobs only",
  salary: "1 to return only jobs with a posted salary",
  workplace: "remote, hybrid or onsite",
  employment: "fulltime, contract, parttime or intern",
  level: "entry, mid, experienced or intern",
  visa: "1 to return only jobs that state visa sponsorship",
  posted: "posted within this many days, 1 to 365",
  page: "page number, 1 to 100; default 1",
  sort: "fresh (default) or pay",
  company: "company slug",
  min_pay: "whole major units per year in currency; matches jobs whose top of range is at or above it",
  currency: "USD (default) or INR; picks the annual column used by min_pay and sort=pay",
  page_size: "1 to 100; default 50",
};

export function llmsTxt(origin: string): string {
  const o = origin.replace(/\/+$/, "");
  const params = API_PARAM_ORDER.map((name) => `- \`${name}\`: ${PARAM_DOCS[name]}`).join("\n");
  return `# Hirelane

> Hirelane is a public board of open jobs read from employers' own applicant-tracking boards. Every job shows the pay it states, how that pay was read, and when it was last checked. Pay is never estimated: a job without a stated salary says so.

## Read the board

- [Jobs](${o}/jobs): the full list with filters; every filter lives in the URL
- [Lists](${o}/lists): curated lists by role, country, remote and posted salary
- [Sitemap](${o}/sitemap.xml): every open job exactly once, closed jobs never

## Public API

Read-only JSON, no key needed. Requests are limited to 60 requests per minute per address; a limited request gets 429 with Retry-After.

- [List jobs](${o}/api/public/jobs): GET, paginated, returns jobs, page, pageSize, pages, total and links
- [One job](${o}/api/public/jobs/{slug}): GET, adds the description, requirements and the pay trace
- [Facet counts](${o}/api/public/facets): GET, counts of open jobs by role, country, remote and salary

Parameters for the list endpoint. An invalid value returns 400 with the parameter name; unknown parameters are ignored.

${params}

Money is in integer minor units of the stated currency (cents, paise). The \`display\` field holds the formatted string. \`total\` is the true number of matches; paging stops at page 100, so narrow the filters to reach the rest.

## Markdown for agents

Each job page has a markdown form with front matter, pay, requirements and the cleaned description.

- Send \`Accept: text/markdown\` to ${o}/job/{slug}, or add \`.md\`: ${o}/job/{slug}.md
- The response is text/markdown and carries Vary: Accept; the HTML page stays the canonical address.

## Applications

Hirelane prepares applications and hands off to the employer's form; it does not submit them, for anyone. There is no API or endpoint that submits an application. Applying always needs the person's own approval: a draft is prepared, the person reviews and approves it, and the hand-off goes to the employer's own application form. Automated agents must not apply on a person's behalf without that approval.
`;
}
