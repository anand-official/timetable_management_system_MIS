import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL ?? 'file:./dev.db';
const sqlitePath = databaseUrl.startsWith('file:')
  ? path.resolve(process.cwd(), 'prisma', databaseUrl.slice('file:'.length))
  : databaseUrl;

export default defineConfig({
  schema: './src/lib/drizzle/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: sqlitePath,
  },
  strict: true,
  verbose: true,
});
