import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { join } from 'node:path';
import { log, type Event } from './log.js';

export class ConfigError extends Error {
  constructor(
    readonly event: Event,
    readonly detail?: number,
  ) {
    super(event);
  }
}

export interface Config {
  url: URL;
  token: string;
  // SHA-256 of the server certificate in DER form; null only for plain http
  // to a loopback address.
  pin: Buffer | null;
}

// Reads WARDEN_URL, WARDEN_TOKEN and WARDEN_TLS_SHA256 from the environment,
// then from the .env file for the ones the environment leaves unset or empty.
// Every refusal happens here, before the bridge opens any socket.
export function loadConfig(env: NodeJS.ProcessEnv, home: string): Config {
  const custom = env.WARDEN_ENV_FILE;
  const file = readEnvFile(custom || join(home, '.config', 'warden-mcp', '.env'), Boolean(custom));
  const setting = (key: string): string => env[key] || file[key] || '';

  let url: URL;
  try {
    url = new URL(setting('WARDEN_URL'));
  } catch {
    throw new ConfigError('url_invalid');
  }
  if (url.username || url.password) throw new ConfigError('url_credentials');
  if (url.protocol === 'http:') {
    if (!isLoopbackLiteral(url.hostname)) throw new ConfigError('http_not_loopback');
  } else if (url.protocol !== 'https:') {
    throw new ConfigError('url_scheme');
  }

  const token = setting('WARDEN_TOKEN');
  if (!token) throw new ConfigError('token_missing');
  if (!/^[\x21-\x7e]+$/.test(token)) throw new ConfigError('token_invalid');

  let pin: Buffer | null = null;
  if (url.protocol === 'https:') {
    const raw = setting('WARDEN_TLS_SHA256').trim();
    if (!raw) throw new ConfigError('pin_missing');
    const hex = raw.replace(/:/g, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new ConfigError('pin_invalid');
    pin = Buffer.from(hex, 'hex');
  }
  return { url, token, pin };
}

// Only literal addresses count: a name such as localhost could resolve
// elsewhere. The URL parser has already put IPv4 in dotted form and IPv6 in
// its shortest form.
function isLoopbackLiteral(hostname: string): boolean {
  return hostname === '[::1]' || (isIPv4(hostname) && hostname.startsWith('127.'));
}

function readEnvFile(path: string, custom: boolean): Record<string, string> {
  // One descriptor for the checks and the read, so the file checked is the
  // file read. O_NOFOLLOW refuses a symbolic link (ELOOP, or EMLINK on
  // FreeBSD) and O_NONBLOCK keeps a FIFO at the path from blocking the open;
  // Windows has neither.
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!custom && code === 'ENOENT') return {};
    throw new ConfigError(code === 'ELOOP' || code === 'EMLINK' ? 'env_file_symlink' : 'env_file_unreadable');
  }
  let text: string;
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new ConfigError('env_file_unreadable');
    const mode = st.mode & 0o777;
    // Windows reports synthetic mode bits, so the check would refuse every file.
    if (process.platform === 'win32') log('env_file_mode_unchecked');
    else if ((mode & 0o077) !== 0) throw new ConfigError(custom ? 'env_file_open_custom' : 'env_file_open', mode);
    text = readFileSync(fd, 'utf8');
  } catch (err) {
    throw err instanceof ConfigError ? err : new ConfigError('env_file_unreadable');
  } finally {
    closeSync(fd);
  }
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || m[1] === undefined || m[2] === undefined) continue;
    let value = m[2];
    if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}
