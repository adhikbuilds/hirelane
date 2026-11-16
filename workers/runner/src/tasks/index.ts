import type { TaskList } from 'graphile-worker';
import { heartbeat } from './heartbeat.js';
import { createEnrichTasks } from './enrich.js';
import { createCompanyTasks } from './company.js';
import { createIngestTasks } from './ingest.js';
import { createResumeExtractTasks } from './resume-extract.js';
import { createResumeRenderTasks } from './resume-render.js';
import { createResumePurgeTasks } from './resume-purge.js';
import { createResumeStuckTasks } from './resume-stuck.js';
import { createCampusStatsTasks } from './campus-stats.js';
import { createApplyTasks } from './apply-submit.js';
import { createInboundTasks } from './inbound-scan.js';
import { createHousekeepingTasks } from './housekeeping.js';
import { createNotifyTasks } from './notify-sweep.js';
import { applyMode, assertApplyDomain } from '../../../../packages/agent/src/apply-mode';

// Startup guard: with auto-apply on, a production worker without a real apply domain must not start (addresses are permanent).
if (applyMode() !== 'off') assertApplyDomain();

export const taskList: TaskList = {
  heartbeat,
  ...createIngestTasks(),
  ...createEnrichTasks(),
  ...createCompanyTasks(),
  ...createResumeExtractTasks(),
  ...createResumeRenderTasks(),
  ...createResumePurgeTasks(),
  ...createResumeStuckTasks(),
  ...createCampusStatsTasks(),
  ...createApplyTasks(),
  ...createInboundTasks(),
  ...createHousekeepingTasks(),
  ...createNotifyTasks(),
};
