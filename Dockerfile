FROM node:24-alpine AS builder

RUN apk add --no-cache \
    bash \
    docker-cli \
    docker-cli-buildx \
    docker-cli-compose \
    git \
    openssh-client

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:24-alpine AS runtime

RUN apk add --no-cache \
    bash \
    docker-cli \
    docker-cli-buildx \
    docker-cli-compose \
    git \
    openssh-client

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts

RUN chmod +x scripts/*.sh

ENV NODE_ENV=production
EXPOSE 3000

CMD ["pnpm", "start"]
