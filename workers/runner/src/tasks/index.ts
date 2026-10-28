import type { TaskList } from 'graphile-worker';
import { heartbeat } from './heartbeat.js';
import { createEnrichTasks } from './enrich.js';
import { createCompanyTasks } from './company.js';
import { createIngestTasks } from './ingest.js';
import { createResumeExtractTasks } from './resume-extract.js';
import { createResumeRenderTasks } from './resume-render.js';
import { createResumePurgeTasks } from './resume-purge.js';
import { createResumeStuckTasks } from './resume-stuck.js';

export const taskList: TaskList = {
  heartbeat,
  ...createIngestTasks(),
  ...createEnrichTasks(),
  ...createCompanyTasks(),
  ...createResumeExtractTasks(),
  ...createResumeRenderTasks(),
  ...createResumePurgeTasks(),
  ...createResumeStuckTasks(),
};
