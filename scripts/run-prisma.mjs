import path from 'node:path';
import { spawnSync } from 'node:child_process';

function resolveRuntimeDatabaseUrl() {
  return (
    process.env.DATABASE_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    ''
  );
}

function resolveCliDatabaseUrl() {
  return (
    process.env.DIRECT_DATABASE_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    resolveRuntimeDatabaseUrl()
  );
}

function resolveSchemaPath() {
  if (process.env.PRISMA_SCHEMA) {
    return process.env.PRISMA_SCHEMA;
  }

  const databaseUrl = resolveRuntimeDatabaseUrl();
  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    return 'prisma/schema.vercel.prisma';
  }

  return 'prisma/schema.prisma';
}

const prismaArgs = process.argv.slice(2);
if (prismaArgs.length === 0) {
  console.error('Usage: node scripts/run-prisma.mjs <prisma args...>');
  process.exit(1);
}

const schemaPath = resolveSchemaPath();
const prismaBinary = path.resolve(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
);
const databaseUrl = resolveCliDatabaseUrl();
const env = {
  ...process.env,
};

if (databaseUrl && !env.DATABASE_URL) {
  env.DATABASE_URL = databaseUrl;
}

const result = spawnSync(prismaBinary, [...prismaArgs, '--schema', schemaPath], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
