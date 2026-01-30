FROM node:20-alpine

# add network utilities for debugging
RUN apk add --no-cache curl wget bind-tools iproute2 netcat-openbsd

WORKDIR /app

# Copy dependency files first for better caching
COPY package*.json ./

# Use npm ci if lockfile exists; otherwise npm install
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy app
COPY . .

EXPOSE 3000

ENV NODE_ENV=production
CMD ["npm","start"]
