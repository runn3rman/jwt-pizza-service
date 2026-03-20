ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-bookworm-slim
WORKDIR /usr/src/app
COPY . .
RUN npm ci
EXPOSE 80
CMD ["node", "index.js", "80"]
