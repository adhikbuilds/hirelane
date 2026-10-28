/**
 * Pins the process timezone to UTC. Imported FIRST by index.ts (ES imports run in order, before the body), so nothing
 * reads local time before this runs. Date maths, cron windows and stored timestamps must not depend on the host TZ.
 */
process.env['TZ'] = 'UTC';
export const WORKER_TZ = 'UTC';
