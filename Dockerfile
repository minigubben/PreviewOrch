FROM node:24-alpine AS builder

RUN apk add --no-cache \
    bash \
    docker-cli \
    docker-cli-buildx \
    docker-cli-compose \
    git \
    openssh-client

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

FROM node:24-alpine AS runtime

RUN apk add --no-cache \
    bash \
    docker-cli \
    docker-cli-buildx \
    docker-cli-compose \
    git \
    openssh-client

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts

RUN chmod +x scripts/*.sh

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
