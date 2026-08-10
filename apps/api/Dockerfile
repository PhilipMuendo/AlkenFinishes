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
# tzdata is what makes TZ mean anything. Alpine ships without it, so Node falls
# back to UTC no matter what TZ is set to — and every server-side day boundary
# (which day a diary draft gathers, when a bill turns overdue) is then three
# hours out from the business it is reporting on. Setting TZ without this is
# a silent no-op, which is the worst kind.
RUN apk add --no-cache openssl tzdata
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
