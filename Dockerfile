FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8099 \
    DATA_DIR=/app/data \
    TZ=Asia/Shanghai

COPY package.json server.js ./
COPY src ./src
COPY web ./web

RUN mkdir -p /app/data/files
VOLUME /app/data
EXPOSE 8099

CMD ["node", "server.js"]
