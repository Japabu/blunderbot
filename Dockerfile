# Debian, not Alpine: the DAVE voice encryption module (@snazzah/davey) ships native builds for
# 32-bit ARM with glibc only, and Discord refuses voice connections without it
FROM node:22-bookworm-slim
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY *.mjs ./
COPY sounds/ ./sounds/
COPY commentary/ ./commentary/

CMD ["node", "index.mjs"]
