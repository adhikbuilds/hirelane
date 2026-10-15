/**
 * postings.raw holds the ATS item exactly as fetched. To get the RawPosting the engine needs, replay it through the
 * real connector (one-item envelope, stub fetch) so Greenhouse's decode-once and Ashby's "compensation hidden" rules
 * stay in one place and cannot drift from ingest.
 */
import { connectors } from '@hirelane/ingest/src/connectors/index';
import type { Ats, RawPosting } from '@hirelane/ingest/src/contract';

export async function rawToPosting(ats: Ats, token: string, raw: unknown): Promise<RawPosting | null> {
  const body = ats === 'lever' ? [raw] : { jobs: [raw] };
  const res = await connectors[ats].fetchBoard(token, {
    mode: 'fixture',
    signal: new AbortController().signal,
    fetch: async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  return res.ok ? (res.postings[0] ?? null) : null;
}
