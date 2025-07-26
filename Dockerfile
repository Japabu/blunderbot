
# Multi-stage build for smaller image
FROM node:alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:alpine AS runtime
WORKDIR /app

# Copy only production dependencies
COPY --from=builder /app/node_modules ./node_modules

# Copy only necessary application files
COPY package.json ./
COPY *.mjs ./
COPY sounds/ ./sounds/

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S blunderbot -u 1001

USER blunderbot

CMD ["npm", "start"]