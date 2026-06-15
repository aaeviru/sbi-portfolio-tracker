FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV SBI_PORTFOLIO_DB_PATH=/app/data/sbi-portfolio-tracker.sqlite

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data

EXPOSE 80

CMD ["npm", "start"]
