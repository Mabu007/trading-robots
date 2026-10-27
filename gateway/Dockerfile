FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts
COPY gateway ./gateway
COPY server ./server
COPY shared ./shared
COPY src/strategy.ts src/types.ts ./src/
ENV GATEWAY_HOST=0.0.0.0 GATEWAY_PORT=8790
USER node
EXPOSE 8790
CMD ["node", "--import", "tsx", "gateway/local.ts"]
