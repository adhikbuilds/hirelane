import type { TaskList } from 'graphile-worker';
import { heartbeat } from './heartbeat.js';

export const taskList: TaskList = { heartbeat };
