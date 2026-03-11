FROM docker.m.daocloud.io/library/node:20-bullseye-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN node scripts/compile.js --emit-app

EXPOSE 8360

CMD ["npm", "run", "start:prod"]
