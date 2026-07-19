# Build from the monorepo root: docker build -f apps/proxy/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY ee/adaptive-cache/package.json ee/adaptive-cache/
COPY apps/proxy/package.json apps/proxy/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY ee/adaptive-cache ee/adaptive-cache
COPY apps/proxy apps/proxy
RUN cd apps/proxy && pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /repo/apps/proxy/dist/index.js ./index.js
COPY --from=build /repo/packages/shared/migrations ./migrations
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "index.js"]
