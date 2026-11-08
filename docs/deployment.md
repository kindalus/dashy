# Container deployment

Dashy ships two container recipes:

- `Containerfile` builds **`dashy-base`**, the engine source installation on `oven/bun:1.4.0-slim`. It installs the locked dependencies and typechecks the engine. It runs no server by itself.
- `examples/external-application/Containerfile` is the **project template**. It builds the project inside `dashy-base`, so custom pages are compiled and the native DuckDB bindings match the container's operating system and architecture. Its final stage keeps only `.output` on a clean Bun image.

```sh
# From the Dashy installation:
podman build --format docker -t localhost/dashy-base:0.3.0 -f Containerfile .
# From the project directory, with the template copied next to dashy.config.ts:
podman build --format docker -t localhost/analytics:1 -f Containerfile .
podman run -d --name analytics -p 127.0.0.1:3000:3000 \
  -v /srv/lake:/data:ro -e DASHY_DATA_DIR=/data \
  -e SESSION_SECRET=… -e OIDC_CLIENT_SECRET=… \
  --memory 768m localhost/analytics:1
```

## Runtime contract

- **Image and user:** the image runs as the unprivileged `bun` user and listens on `PORT` (default 3000).
- **Health:** `GET /healthz` returns `{"status":"ok"}`. It is public and reads no data. The template declares a `HEALTHCHECK`; Podman keeps it only with `--format docker`.
- **Data:** relative sources are packaged under `/app/data`. For external data such as a lakehouse, mount it read-only and set `DASHY_DATA_DIR`.
  - A glob that matches no files does not prevent startup. Queries over it answer `503` until data arrives.
- **Temporary files:** DuckDB spills to `limits.tempDirectory`, which defaults to the OS temporary directory. Keep it writable.
- **Memory:** size `limits.memory` below the container's memory limit and leave room for Bun and the result cache.
- **Secrets:** pass secrets as environment variables. Configuration files are bundled into the image at build time.
- **Updates:** configuration and custom pages change only with a new image. Roll back by running the previous tag.

## Verification

`bun run check:container` builds both images with Podman (or Docker), runs the example project and checks:

- the non-root user;
- the health probe, SSR, the catalog and a dataset.

It removes the images afterwards; pass `--keep` to inspect them.
