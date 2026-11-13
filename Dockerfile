# Knowledge Review web app + Claude harness (PDF section 3: one EC2, Docker Compose).
# Multi-arch: builds on x64 and on the t4g (ARM64) EC2; npm ci picks the matching Claude engine binary.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

# One-shot setup run by docker compose before the web app starts (`npm run deploy:init`): creates the tables on an empty
# database, creates the first admin, loads the knowledge base and pushes the flashcards. Needs tsx and the scripts, so it
# keeps the dev dependencies the runtime image below does not have. Runs as the unprivileged `node` user.
FROM deps AS init
ENV NEXT_TELEMETRY_DISABLED=1 KB_DIR=/app/kb
COPY . .
USER node
CMD ["npm", "run", "deploy:init"]

FROM node:24-bookworm-slim AS run
# PORT is the one port the whole app (pages and API: Next.js serves both) listens on. docker-compose sets it from APP_PORT in
# .env at run time; 3000 is only the default for a plain `docker run`.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# ca-certificates: HTTPS to Anthropic and the KB MCP server.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 app
WORKDIR /app
# App files are owned by root and read-only for the runtime user (REQ-NFR-05).
COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/db ./db
COPY --from=build /app/claude-harness ./claude-harness
# The admin "sync knowledge base" button reads the YAML snapshot from KB_DIR.
COPY --from=build /app/kb ./kb
# Claude credentials and session transcripts (for resume) live in a volume owned by the runtime user.
ENV CLAUDE_CONFIG_DIR=/home/app/.claude CLAUDE_HARNESS_DIR=/app/claude-harness
RUN mkdir -p /home/app/.claude && chown app:app /home/app/.claude
USER app
EXPOSE 3000
# Both the health check and the start command read PORT, so changing APP_PORT in .env needs no image change.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "exec node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
