import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { drizzleSchema } from './schema';

const globalForDrizzle = globalThis as unknown as {
  sqlite: Database.Database | undefined;
  drizzleDb: ReturnType<typeof drizzle<typeof drizzleSchema>> | undefined;
};

function resolveSqlitePath(url: string) {
  if (!url.startsWith('file:')) {
    throw new Error(`Expected a SQLite file DATABASE_URL, received: ${url}`);
  }

  const relativePath = url.slice('file:'.length);
  return path.resolve(process.cwd(), 'prisma', relativePath);
}

const sqlitePath = resolveSqlitePath(process.env.DATABASE_URL ?? 'file:./dev.db');
const sqlite =
  globalForDrizzle.sqlite ??
  new Database(sqlitePath, {
    fileMustExist: true,
  });

export const drizzleDb =
  globalForDrizzle.drizzleDb ??
  drizzle({
    client: sqlite,
    schema: drizzleSchema,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDrizzle.sqlite = sqlite;
  globalForDrizzle.drizzleDb = drizzleDb;
}
