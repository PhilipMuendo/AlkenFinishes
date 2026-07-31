# ---- build ----
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @alken/api
COPY apps/api apps/api
RUN cd apps/api && npx prisma generate && npm run build

# ---- runtime ----
FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @alken/api --omit=dev
COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && npx prisma generate
# Fonts for PDF generation (invoices, receipts). node:22-alpine ships no system
# fonts, so pdfmake renders from these bundled TTFs — without this COPY every
# invoice 500s in production while working fine in dev. services/pdf.ts asserts
# their presence at boot so a missing COPY fails the container, not a request.
COPY apps/api/assets apps/api/assets
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && node dist/server.js"]
