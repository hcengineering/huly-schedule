FROM node:20-slim
WORKDIR /app

COPY . .

RUN npm install
RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=8060
EXPOSE 8060
CMD ["node", "./dist/server/entry.mjs"]
