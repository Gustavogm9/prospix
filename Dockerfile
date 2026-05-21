FROM node:20-alpine AS base
RUN apk add --no-cache openssl libc6-compat
RUN npm install -g pnpm@9.15.0

FROM base AS build
WORKDIR /usr/src/app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

COPY packages/shared-types ./packages/shared-types
COPY apps/api ./apps/api
RUN pnpm --filter @prospix/api db:generate
RUN pnpm --filter @prospix/api build

FROM base AS api
WORKDIR /app
COPY --from=build /usr/src/app/package.json /usr/src/app/pnpm-workspace.yaml /usr/src/app/pnpm-lock.yaml /usr/src/app/tsconfig.base.json ./
COPY --from=build /usr/src/app/packages/shared-types ./packages/shared-types
COPY --from=build /usr/src/app/apps/api ./apps/api
RUN pnpm install --prod --frozen-lockfile
RUN pnpm --filter @prospix/api db:generate

WORKDIR /app/apps/api
EXPOSE 3000
CMD [ "node", "dist/index.js" ]
