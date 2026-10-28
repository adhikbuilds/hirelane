import { randomUUID } from 'node:crypto';
import { addJob } from '@hirelane/db';
import type { BlobStore, KeyProvider } from '@hirelane/vault';
import { ServiceError } from './errors';
import { idPayload, idSchema, type JobPayload } from './schema';

export interface EnqueueOptions {
  /** Graphile dedup/replace key. */
  jobKey?: string;
}

/** Enqueue a worker task. Payloads carry ids only. */
export type Enqueue = (task: string, payload: JobPayload, opts?: EnqueueOptions) => Promise<void>;

/** Everything a service needs, passed explicitly so a service never reads globals and tests inject fakes. */
export interface ServiceCtx {
  readonly userId: string;
  readonly requestId: string;
  readonly now: () => Date;
  readonly blobs: BlobStore;
  readonly keys: KeyProvider;
  readonly enqueue: Enqueue;
}

export interface CreateServiceCtxInput {
  userId: string;
  blobs: BlobStore;
  keys: KeyProvider;
  requestId?: string;
  now?: () => Date;
  enqueue?: Enqueue;
}

/** Default enqueue: refuse anything that is not an id-only payload, then hand it to graphile via packages/db. */
const defaultEnqueue: Enqueue = async (task, payload, opts = {}) => {
  if (!idPayload.safeParse(payload).success) throw new ServiceError('bad_job_payload', 500);
  await addJob(task, payload, opts.jobKey ? { jobKey: opts.jobKey } : {});
};

export function createServiceCtx(input: CreateServiceCtxInput): ServiceCtx {
  if (!idSchema.safeParse(input.userId).success) throw new ServiceError('unauthenticated', 401);
  return {
    userId: input.userId,
    requestId: input.requestId ?? randomUUID(),
    now: input.now ?? (() => new Date()),
    blobs: input.blobs,
    keys: input.keys,
    enqueue: input.enqueue ?? defaultEnqueue,
  };
}
