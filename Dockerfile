FROM node:24-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++ \
  && npm ci --omit=dev

FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV SBI_PORTFOLIO_DB_PATH=/app/data/sbi-portfolio-tracker.sqlite

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data

EXPOSE 80

CMD ["npm", "start"]
