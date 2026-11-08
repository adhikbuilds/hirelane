# Graphile worker image for the public demo (Fly.io, or any container host).
#
# Build from the REPOSITORY ROOT, not from this folder:
#   docker build -f workers/runner/Dockerfile -t hirelane-runner .
#
# The image holds no secrets. Every value (DATABASE_URL, HIRELANE_MASTER_KEY, ...) comes from the host's environment
# at run time (fly secrets). What is excluded from the build context is listed in workers/runner/Dockerfile.dockerignore.
FROM node:22.18-bookworm-slim

# pnpm is pinned by the root package.json ("packageManager": "pnpm@9.12.0"); corepack reads that pin.
RUN corepack enable

WORKDIR /app

# The whole workspace is copied because packages, apps and workers depend on each other.
COPY . .

# Full install with dev dependencies: the worker starts with vite-node, which is a devDependency of workers/runner.
# NODE_ENV is NOT set yet: with NODE_ENV=production pnpm would skip every devDependency, and vite-node with it.
RUN pnpm install --frozen-lockfile

# Set only after the install (see above).
ENV NODE_ENV=production

# Writable state for the non-root user: resume blobs (HIRELANE_STORAGE_DIR) and company logos (HIRELANE_LOGO_DIR).
# Mount a volume on /data only if the web app shares that disk (see docs/DEPLOY-DEMO.md, storage).
RUN mkdir -p /data/blobs /data/logos && chown -R node:node /data
ENV HIRELANE_STORAGE_DIR=/data/blobs \
    HIRELANE_LOGO_DIR=/data/logos

USER node

WORKDIR /app/workers/runner

# Exec form: vite-node is PID 1, so SIGTERM from the platform reaches graphile-worker, which then drains its jobs.
CMD ["node_modules/.bin/vite-node", "src/index.ts"]
