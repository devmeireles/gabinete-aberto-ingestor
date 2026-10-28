FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM build AS migrate
CMD ["npm", "run", "db:migrate"]

FROM node:22-slim AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 8080

CMD ["node", "dist/main.js"]
