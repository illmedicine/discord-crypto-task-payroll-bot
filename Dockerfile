FROM node:20-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
# Force cache bust on every deploy
ARG CACHEBUST=1
RUN echo "deploy: $(date -u +%Y%m%dT%H%M%SZ)" > /app/.deploy-ts
CMD ["node", "index.js"]
