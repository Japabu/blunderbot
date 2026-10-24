# Debian, not Alpine: the DAVE voice encryption module (@snazzah/davey) ships native builds for
# 32-bit ARM with glibc only, and Discord refuses voice connections without it
FROM node:22-bookworm-slim
WORKDIR /app

# Audio uploads are converted once, then streamed as cached Opus during games.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY *.mjs ./
COPY sounds/ ./sounds/
COPY commentary/ ./commentary/
COPY web/ ./web/

CMD ["node", "index.mjs"]
