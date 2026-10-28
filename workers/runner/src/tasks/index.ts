import type { TaskList } from 'graphile-worker';
import { heartbeat } from './heartbeat.js';
import { createEnrichTasks } from './enrich.js';
import { createCompanyTasks } from './company.js';
import { createIngestTasks } from './ingest.js';

export const taskList: TaskList = { heartbeat, ...createIngestTasks(), ...createEnrichTasks(), ...createCompanyTasks() };
