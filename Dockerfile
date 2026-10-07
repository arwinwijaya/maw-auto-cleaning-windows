# syntax=docker/dockerfile:1

# Disk Usage Analyzer — read-only WinDirStat-style disk analyzer.
#
# Runs the Node.js server inside a Linux container. Windows drives are mapped
# onto a read-only bind mount of the host drive (see docker-compose.yml +
# SCAN_HOST_MOUNT), so the UI keeps showing the real `C:\...` paths while the
# process reads them through the mount.
#
# This image never deletes anything: it only reads directory metadata. There are
# no write endpoints, no shell execution and no writable mounts.
FROM node:24-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3456 \
    SCAN_HOST_MOUNT=/mnt/c

WORKDIR /app

# Copy only what the server needs at runtime (tests/docs stay out of the image).
COPY server.js ./
COPY lib ./lib
COPY public ./public

# Drop privileges: the scanner only needs read access to the bind mounts.
USER node

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3456/ || exit 1

CMD ["node", "server.js"]
