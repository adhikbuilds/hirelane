/** Stored in user_job_matches.engine_version and in every Trace. Semver. */
export const ENGINE_VERSION = '1.0.0' as const;
/** Stored in jobs.enrich_version (integer). Any bump re-enriches every posting. */
export const ENRICH_VERSION = 1 as const;
/** Version of the Doc.text derivation. A change implies an ENRICH_VERSION bump, because stored spans move. */
export const DOC_FORMAT_VERSION = 1 as const;
