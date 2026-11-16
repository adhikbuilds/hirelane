import { createServiceCtx, type Enqueue, type ServiceCtx } from "@hirelane/services";
import { EnvKeyProvider, localBlobStoreFromEnv, type BlobStore, type KeyProvider } from "@hirelane/vault";

let keys: KeyProvider | undefined;
const sharedKeys = (): KeyProvider => (keys ??= new EnvKeyProvider());

/** The one place the web app wires the service layer: real keys, the local blob store, graphile enqueue. */
export function serviceCtxFor(userId: string, opts: { requestId?: string; blobs?: BlobStore; keys?: KeyProvider; now?: () => Date; enqueue?: Enqueue } = {}): ServiceCtx {
  return createServiceCtx({
    userId,
    blobs: opts.blobs ?? localBlobStoreFromEnv(),
    keys: opts.keys ?? sharedKeys(),
    ...(opts.requestId ? { requestId: opts.requestId } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.enqueue ? { enqueue: opts.enqueue } : {}),
  });
}

export { sharedKeys as v1Keys };
