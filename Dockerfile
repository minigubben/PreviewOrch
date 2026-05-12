FROM node:24-alpine

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

COPY . .

RUN chmod +x scripts/*.sh

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
