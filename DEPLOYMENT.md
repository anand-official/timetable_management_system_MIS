# Deployment

## Local development

- This repo uses `prisma/schema.prisma` with SQLite.
- Local `.env` should keep `DATABASE_URL="file:./dev.db"`.
- `npm run dev`, `npm run build`, and `npm install` automatically generate Prisma from the SQLite schema.

## Vercel

- Do not deploy with a local SQLite file. Use a hosted Postgres database.
- Recommended setup: connect a managed Postgres provider through Vercel.
- Vercel project environment variables are automatically available during both build and runtime, so secrets should be configured in the Vercel project rather than committed into `vercel.json`.
- The app accepts these production environment variables:
- `DATABASE_URL` for the runtime connection string.
- `POSTGRES_PRISMA_URL` or `POSTGRES_URL` as runtime fallbacks when `DATABASE_URL` is not set.
- `DIRECT_DATABASE_URL` or `POSTGRES_URL_NON_POOLING` for Prisma CLI commands such as `db push` and `migrate`.
- When the resolved runtime database URL starts with `postgres://` or `postgresql://`, the build scripts automatically switch Prisma generation to `prisma/schema.vercel.prisma`.
- No extra build-command override is required if `DATABASE_URL` is present in Vercel.
- `vercel.json` uses the default Next.js output directory with explicit install/build commands:
  - `npm install`
  - `npm run build`

## Recommended Vercel env setup

- Runtime: set `DATABASE_URL` to your pooled Postgres connection string.
- Prisma CLI: set `DIRECT_DATABASE_URL` to a direct non-pooled connection string if your provider exposes one.
- If your Vercel storage integration gives you `POSTGRES_PRISMA_URL` and `POSTGRES_URL_NON_POOLING` instead, the app and Prisma wrapper will use those automatically.

## Commands

- Local Prisma generate: `npm run db:generate`
- Local Prisma push: `npm run db:push`
- Drizzle generate: `npm run db:drizzle:generate`
- Drizzle push: `npm run db:drizzle:push`

## Migration direction

- Current production-safe path: Prisma + hosted Postgres on Vercel.
- Ongoing migration path: Drizzle is scaffolded in `src/lib/drizzle/` for incremental route-by-route replacement.
