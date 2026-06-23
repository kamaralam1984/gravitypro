# Gravity web — multi-stage: build the Vite SPA, serve + proxy with Caddy.

# ---------- Stage 1: build the React/Vite bundle ----------
FROM node:22-alpine AS build
WORKDIR /app
# vite 8 / rolldown ships platform-specific optional deps (@emnapi/*) that make the
# committed lockfile incomplete on alpine — use npm install so the build is portable.
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- Stage 2: Caddy serves /srv and proxies /api -> backend ----------
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
