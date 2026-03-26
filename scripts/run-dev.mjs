import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

function parsePortArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-p' || arg === '--port') {
      const next = Number(args[index + 1]);
      return Number.isInteger(next) && next > 0 ? next : null;
    }
    if (arg.startsWith('--port=')) {
      const value = Number(arg.slice('--port='.length));
      return Number.isInteger(value) && value > 0 ? value : null;
    }
  }
  return null;
}

function stripPortArgs(args) {
  const stripped = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-p' || arg === '--port') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      continue;
    }
    stripped.push(arg);
  }
  return stripped;
}

function isFreePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort, attempts = 20) {
  for (let offset = 0; offset <= attempts; offset += 1) {
    const port = startPort + offset;
    if (await isFreePort(port)) {
      return port;
    }
  }
  return null;
}

const forwardedArgs = process.argv.slice(2);
const requestedPort =
  parsePortArg(forwardedArgs) ??
  (Number.isInteger(Number(process.env.PORT)) && Number(process.env.PORT) > 0
    ? Number(process.env.PORT)
    : 3000);

const projectRoot = process.cwd();
const prismaScript = path.resolve(projectRoot, 'scripts', 'run-prisma.mjs');
const nextBinary = path.resolve(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'next.cmd' : 'next'
);

const prismaResult = spawnSync(
  process.execPath,
  [prismaScript, 'generate', '--soft-lock-ok'],
  {
    stdio: 'inherit',
    cwd: projectRoot,
    env: process.env,
  }
);

if (prismaResult.error) {
  console.error(prismaResult.error);
  process.exit(1);
}

if ((prismaResult.status ?? 1) !== 0) {
  process.exit(prismaResult.status ?? 1);
}

const port = await findAvailablePort(requestedPort);
if (port === null) {
  console.error(`[run-dev] No free port found between ${requestedPort} and ${requestedPort + 20}.`);
  process.exit(1);
}

if (port !== requestedPort) {
  console.warn(`[run-dev] Port ${requestedPort} is in use. Starting Next dev on ${port} instead.`);
}

const nextArgs = ['dev', '-p', String(port), ...stripPortArgs(forwardedArgs)];
const child = spawn(nextBinary, nextArgs, {
  stdio: 'inherit',
  cwd: projectRoot,
  env: {
    ...process.env,
    PORT: String(port),
  },
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
