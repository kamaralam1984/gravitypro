# Gravity backend — Express API (port 8002)
FROM node:22-alpine

WORKDIR /app

# Install production deps only (nodemon is dev-only)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8002
EXPOSE 8002

# Lazy DB pool — server boots without a live DB; /health works immediately
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8002/health || exit 1

CMD ["node", "src/app.js"]
