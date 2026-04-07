FROM node:22-slim AS base
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json ./
RUN npm install --production=false

COPY prisma prisma
RUN npx prisma generate

COPY src src
COPY public public
COPY tsconfig.json ./
RUN npx tsc

EXPOSE 4404
CMD ["node", "dist/server.js"]
