FROM docker.m.daocloud.io/library/node:18-bullseye-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --include=dev && npm cache clean --force

COPY . .

EXPOSE 8360

CMD ["npm", "start"]
