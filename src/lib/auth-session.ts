const AUTH_COOKIE_NAME = 'mis-access';
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

const enc = new TextEncoder();
const dec = new TextDecoder();

let cachedSecret = '';
let cachedKeyPromise: Promise<CryptoKey> | null = null;

type SessionPayload = {
  exp: number;
  v: 1;
};

function bytesToBase64Url(bytes: Uint8Array) {
  const base64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(bytes).toString('base64')
      : btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary =
    typeof Buffer !== 'undefined'
      ? Buffer.from(padded, 'base64').toString('binary')
      : atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function getSessionSecret() {
  return process.env.AUTH_SESSION_SECRET || process.env.ACCESS_CODE || process.env.MIS_ACCESS_CODE || null;
}

async function getSigningKey() {
  const secret = getSessionSecret();
  if (!secret) return null;

  if (!cachedKeyPromise || cachedSecret !== secret) {
    cachedSecret = secret;
    cachedKeyPromise = crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }

  return cachedKeyPromise;
}

async function signValue(value: string) {
  const key = await getSigningKey();
  if (!key) return null;

  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

export function isSafeNextPath(value: string | null | undefined): value is string {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
    && !/[\r\n]/.test(value);
}

export async function createAuthSessionValue(now = Date.now()) {
  const payload: SessionPayload = {
    exp: now + (AUTH_COOKIE_MAX_AGE_SECONDS * 1000),
    v: 1,
  };
  const encodedPayload = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
  const signature = await signValue(encodedPayload);
  if (!signature) return null;

  return `${encodedPayload}.${signature}`;
}

export async function verifyAuthSessionValue(value: string | null | undefined) {
  if (!value) return false;

  const parts = value.split('.');
  if (parts.length !== 2) return false;

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return false;

  const key = await getSigningKey();
  if (!key) return false;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(dec.decode(base64UrlToBytes(encodedPayload))) as SessionPayload;
  } catch {
    return false;
  }

  if (payload?.v !== 1 || typeof payload.exp !== 'number' || payload.exp <= Date.now()) {
    return false;
  }

  try {
    return await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(signature),
      enc.encode(encodedPayload)
    );
  } catch {
    return false;
  }
}

export {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
};
