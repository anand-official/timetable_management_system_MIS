import fs from 'node:fs';
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

const rawArgs = process.argv.slice(2);
const softLockOk = rawArgs.includes('--soft-lock-ok');
const prismaArgs = rawArgs.filter((arg) => arg !== '--soft-lock-ok');
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

function getPrismaClientDir() {
  return path.resolve(process.cwd(), 'node_modules', '.prisma', 'client');
}

function getEnginePath() {
  return path.join(getPrismaClientDir(), 'query_engine-windows.dll.node');
}

function hasExistingPrismaClient() {
  const clientDir = getPrismaClientDir();
  return (
    fs.existsSync(path.join(clientDir, 'index.js')) &&
    fs.existsSync(getEnginePath())
  );
}

function cleanupStaleEngineTemps() {
  if (process.platform !== 'win32') return;
  const clientDir = getPrismaClientDir();
  if (!fs.existsSync(clientDir)) return;

  for (const entry of fs.readdirSync(clientDir)) {
    if (!entry.startsWith('query_engine-windows.dll.node.tmp')) continue;
    try {
      fs.rmSync(path.join(clientDir, entry), { force: true });
    } catch {
      // Ignore cleanup failures; the main Prisma invocation will surface real errors.
    }
  }
}

function isLockedEngineRenameFailure(output) {
  return (
    process.platform === 'win32' &&
    prismaArgs[0] === 'generate' &&
    output.includes('EPERM: operation not permitted, rename') &&
    output.includes('query_engine-windows.dll.node')
  );
}

if (databaseUrl && !env.DATABASE_URL) {
  env.DATABASE_URL = databaseUrl;
}

cleanupStaleEngineTemps();

const result = spawnSync(prismaBinary, [...prismaArgs, '--schema', schemaPath], {
  stdio: 'pipe',
  env,
  shell: process.platform === 'win32',
  encoding: 'utf8',
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

const status = result.status ?? 1;
const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

if (status !== 0 && softLockOk && isLockedEngineRenameFailure(output) && hasExistingPrismaClient()) {
  cleanupStaleEngineTemps();
  console.warn(
    '[run-prisma] Prisma generate could not replace the Windows query engine because it is locked by another process. Using the existing generated client for dev.'
  );
  process.exit(0);
}

process.exit(status);
