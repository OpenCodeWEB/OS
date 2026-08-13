# ===================================================================
# Dockerfile — Multi-stage build for OpenCodeWEBsUI
# Language: Dockerfile
# Purpose: Reproducible local dev environment + production build
# ===================================================================

# ---- Stage 1: Install dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---- Stage 2: Build ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx vite build

# ---- Stage 3: Production serve ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/dist ./dist

RUN npm install -g serve

EXPOSE 3000

CMD ["serve", "dist", "-p", "3000", "--cors"]
