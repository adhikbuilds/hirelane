import type { TaskList } from 'graphile-worker';
import { heartbeat } from './heartbeat.js';
import { createIngestTasks } from './ingest.js';

export const taskList: TaskList = { heartbeat, ...createIngestTasks() };
