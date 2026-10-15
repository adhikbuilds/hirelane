import { hostname } from 'node:os';
import type { Task } from 'graphile-worker';

const WORKER_ID = `${hostname()}:${process.pid}`;

/** Liveness signal: one row per run, rows older than a day pruned. */
export const heartbeat: Task = async (_payload, helpers) => {
  await helpers.withPgClient(async (client) => {
    await client.query('INSERT INTO worker_heartbeats (worker_id) VALUES ($1)', [WORKER_ID]);
    await client.query("DELETE FROM worker_heartbeats WHERE at < now() - interval '1 day'");
  });
};
