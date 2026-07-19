# Build from the monorepo root: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY ee/adaptive-cache/package.json ee/adaptive-cache/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY ee/adaptive-cache ee/adaptive-cache
COPY apps/web apps/web
ARG NEXT_PUBLIC_PROXY_URL=https://proxy.caching.ai
ENV NEXT_PUBLIC_PROXY_URL=$NEXT_PUBLIC_PROXY_URL
RUN cd apps/web && pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# standalone output does not bundle public/ — copy it explicitly
COPY --from=build /repo/apps/web/public ./apps/web/public
COPY --from=build /repo/packages/shared/migrations ./migrations
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
