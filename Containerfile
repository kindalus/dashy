# Dashy base image: the engine source installation, used to build projects.
#
#   podman build -t localhost/dashy-base:0.3.0 -f Containerfile .
#
# Projects build FROM this image (see examples/external-application/Containerfile):
# their custom pages are compiled and native DuckDB bindings match the
# container's OS and architecture. The image runs no server by itself.
FROM docker.io/oven/bun:1.4.0-slim

WORKDIR /opt/dashy
ENV DASHY_INSTALLATION=/opt/dashy

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Fail the image build early if the engine does not typecheck.
RUN bun run typecheck

LABEL org.opencontainers.image.title="dashy-base" \
      org.opencontainers.image.version="0.3.0" \
      org.opencontainers.image.description="Dashy engine installation for building project images"
