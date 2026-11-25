import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, symlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.js';
import { message, type Event } from '../src/log.js';
import { BRIDGE, PIN, TOKEN, portOf, runBridge, tempDir, writeFile } from './helpers.js';

const URL_HTTPS = 'https://192.0.2.10:8053/mcp';

function refused(fn: () => unknown, event: Event, detail?: number): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.event, event);
    assert.equal(err.detail, detail);
    return true;
  });
}

function defaultEnvFile(home: string): string {
  return join(home, '.config', 'warden-mcp', '.env');
}

test('the environment wins over the .env file', () => {
  const home = tempDir();
  writeFile(
    defaultEnvFile(home),
    `WARDEN_URL=https://192.0.2.99:9999/mcp\nWARDEN_TOKEN=file-token\nWARDEN_TLS_SHA256=${'ef'.repeat(32)}\n`,
    0o600,
  );
  const cfg = loadConfig({ WARDEN_URL: URL_HTTPS, WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: PIN }, home);
  assert.equal(cfg.url.href, URL_HTTPS);
  assert.equal(cfg.token, TOKEN);
  assert.equal(cfg.pin?.toString('hex'), PIN);
});

test('the .env file fills the variables the environment leaves unset or empty', () => {
  const home = tempDir();
  writeFile(
    defaultEnvFile(home),
    `# comment\n\nexport WARDEN_URL="${URL_HTTPS}"\nWARDEN_TOKEN = '${TOKEN}'\r\nWARDEN_TLS_SHA256=${PIN}\n`,
    0o600,
  );
  const cfg = loadConfig({ WARDEN_TOKEN: '' }, home);
  assert.equal(cfg.url.href, URL_HTTPS);
  assert.equal(cfg.token, TOKEN);
  assert.equal(cfg.pin?.toString('hex'), PIN);
});

test('a byte order mark at the start of the .env file is ignored', () => {
  const home = tempDir();
  writeFile(defaultEnvFile(home), `\uFEFFWARDEN_URL=${URL_HTTPS}\r\nWARDEN_TOKEN=${TOKEN}\r\n`, 0o600);
  const cfg = loadConfig({ WARDEN_TLS_SHA256: PIN }, home);
  assert.equal(cfg.url.href, URL_HTTPS);
  assert.equal(cfg.token, TOKEN);
});

test('WARDEN_ENV_FILE replaces the default .env path', () => {
  const home = tempDir();
  writeFile(defaultEnvFile(home), 'WARDEN_TOKEN=default-file\n', 0o600);
  const custom = join(tempDir(), 'agent.env');
  writeFile(custom, `WARDEN_TOKEN=${TOKEN}\n`, 0o600);
  const cfg = loadConfig({ WARDEN_ENV_FILE: custom, WARDEN_URL: URL_HTTPS, WARDEN_TLS_SHA256: PIN }, home);
  assert.equal(cfg.token, TOKEN);
});

test('a missing default .env file is not an error', () => {
  const cfg = loadConfig({ WARDEN_URL: URL_HTTPS, WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: PIN }, tempDir());
  assert.equal(cfg.token, TOKEN);
});

test('a WARDEN_ENV_FILE that does not exist is refused', () => {
  const env = { WARDEN_ENV_FILE: join(tempDir(), 'missing.env'), WARDEN_URL: URL_HTTPS, WARDEN_TOKEN: TOKEN };
  refused(() => loadConfig({ ...env, WARDEN_TLS_SHA256: PIN }, tempDir()), 'env_file_unreadable');
});

test('a .env file that is a symbolic link is refused, even to a private file', () => {
  const target = join(tempDir(), 'real.env');
  writeFile(target, `WARDEN_TOKEN=${TOKEN}\n`, 0o600);
  const home = tempDir();
  mkdirSync(dirname(defaultEnvFile(home)), { recursive: true });
  symlinkSync(target, defaultEnvFile(home));
  const env = { WARDEN_URL: URL_HTTPS, WARDEN_TLS_SHA256: PIN };
  refused(() => loadConfig(env, home), 'env_file_symlink');
  refused(() => loadConfig({ ...env, WARDEN_ENV_FILE: defaultEnvFile(home) }, tempDir()), 'env_file_symlink');
  assert.equal(loadConfig({ ...env, WARDEN_ENV_FILE: target }, tempDir()).token, TOKEN);
});

test('a .env path that is a FIFO is refused without waiting for a writer', () => {
  const fifo = join(tempDir(), 'agent.env');
  execFileSync('mkfifo', ['-m', '600', fifo]);
  // In a child with a time limit, so an open that waits for a writer fails
  // the test instead of blocking the test process.
  const env = { PATH: process.env.PATH ?? '', HOME: tempDir(), WARDEN_ENV_FILE: fifo, WARDEN_URL: URL_HTTPS };
  const run = spawnSync(process.execPath, [BRIDGE], { timeout: 5000, encoding: 'utf8', env });
  assert.equal(run.status, 2);
  assert.equal(run.stderr, `warden-mcp: ${message('env_file_unreadable')}\n`);
});

test('a .env file with a group permission bit is refused with a chmod hint', () => {
  const home = tempDir();
  writeFile(defaultEnvFile(home), `WARDEN_TOKEN=${TOKEN}\n`, 0o640);
  refused(() => loadConfig({ WARDEN_URL: URL_HTTPS, WARDEN_TLS_SHA256: PIN }, home), 'env_file_open', 0o640);
  assert.match(message('env_file_open', 0o640), /mode 640\b.*chmod 600 ~\/\.config\/warden-mcp\/\.env/);
});

test('a .env file with an other permission bit is refused', () => {
  const home = tempDir();
  writeFile(defaultEnvFile(home), `WARDEN_TOKEN=${TOKEN}\n`, 0o604);
  refused(() => loadConfig({ WARDEN_URL: URL_HTTPS, WARDEN_TLS_SHA256: PIN }, home), 'env_file_open', 0o604);
});

test('a WARDEN_ENV_FILE open to other users gets a hint that names the variable', () => {
  const custom = join(tempDir(), 'agent.env');
  writeFile(custom, `WARDEN_TOKEN=${TOKEN}\n`, 0o644);
  const env = { WARDEN_ENV_FILE: custom, WARDEN_URL: URL_HTTPS, WARDEN_TLS_SHA256: PIN };
  refused(() => loadConfig(env, tempDir()), 'env_file_open_custom', 0o644);
  assert.match(message('env_file_open_custom', 0o644), /chmod 600 "\$WARDEN_ENV_FILE"/);
});

test('https without WARDEN_TLS_SHA256 is refused', () => {
  refused(() => loadConfig({ WARDEN_URL: URL_HTTPS, WARDEN_TOKEN: TOKEN }, tempDir()), 'pin_missing');
});

test('https with an empty WARDEN_TLS_SHA256 is refused', () => {
  const env = { WARDEN_URL: URL_HTTPS, WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: ' ' };
  refused(() => loadConfig(env, tempDir()), 'pin_missing');
});

test('https with a pin that is not 64 hex digits is refused', () => {
  for (const pin of [PIN.slice(1), `${PIN}a`, `g${PIN.slice(1)}`, `sha256 Fingerprint=${PIN}`]) {
    const env = { WARDEN_URL: URL_HTTPS, WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: pin };
    refused(() => loadConfig(env, tempDir()), 'pin_invalid');
  }
});

test('colons and upper case in the pin are accepted', () => {
  const pin = PIN.toUpperCase().match(/../g)?.join(':') ?? '';
  const cfg = loadConfig({ WARDEN_URL: URL_HTTPS, WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: pin }, tempDir());
  assert.equal(cfg.pin?.toString('hex'), PIN);
});

test('plain http to 127.0.0.0/8 or [::1] is accepted without a pin', () => {
  for (const url of ['http://127.0.0.1:8053/mcp', 'http://127.4.5.6/mcp', 'http://[::1]:8053/mcp']) {
    const cfg = loadConfig({ WARDEN_URL: url, WARDEN_TOKEN: TOKEN }, tempDir());
    assert.equal(cfg.pin, null, url);
  }
});

test('plain http to localhost, a LAN address, a name or a mapped IPv4 address is refused', () => {
  for (const url of [
    'http://localhost:8053/mcp',
    'http://192.0.2.10:8053/mcp',
    'http://warden.lan:8053/mcp',
    'http://[::ffff:127.0.0.1]:8053/mcp',
    'http://[fe80::1]:8053/mcp',
  ]) {
    const env = { WARDEN_URL: url, WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: PIN };
    refused(() => loadConfig(env, tempDir()), 'http_not_loopback');
  }
});

test('a URL with a user name or password is refused', () => {
  for (const url of ['https://agent@192.0.2.10:8053/mcp', 'https://agent:secret@192.0.2.10:8053/mcp']) {
    const env = { WARDEN_URL: url, WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: PIN };
    refused(() => loadConfig(env, tempDir()), 'url_credentials');
  }
});

test('a scheme other than https or http is refused', () => {
  for (const url of ['ws://127.0.0.1:8053/mcp', 'ftp://192.0.2.10/mcp']) {
    const env = { WARDEN_URL: url, WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: PIN };
    refused(() => loadConfig(env, tempDir()), 'url_scheme');
  }
});

test('a missing or malformed WARDEN_URL is refused', () => {
  refused(() => loadConfig({ WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: PIN }, tempDir()), 'url_invalid');
  const env = { WARDEN_URL: '192.0.2.10:8053/mcp', WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: PIN };
  refused(() => loadConfig(env, tempDir()), 'url_invalid');
});

test('a missing WARDEN_TOKEN, or one that cannot go in a header, is refused', () => {
  refused(() => loadConfig({ WARDEN_URL: URL_HTTPS, WARDEN_TLS_SHA256: PIN }, tempDir()), 'token_missing');
  for (const token of [`${TOKEN} x`, `${TOKEN}\r\nX-Injected: 1`]) {
    const env = { WARDEN_URL: URL_HTTPS, WARDEN_TOKEN: token, WARDEN_TLS_SHA256: PIN };
    refused(() => loadConfig(env, tempDir()), 'token_invalid');
  }
});

let listener: Server;
let connections = 0;
let port = 0;

before(async () => {
  listener = createServer((sock) => {
    connections += 1;
    sock.destroy();
  });
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  port = portOf(listener);
});

after(() => listener.close());

test('a pin that is unset, empty or not 64 hex makes the bridge exit 2 before any socket opens', async () => {
  const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  for (const pin of [undefined, '', 'zz'.repeat(32)]) {
    const env: Record<string, string> = { WARDEN_URL: `https://127.0.0.1:${port}/mcp`, WARDEN_TOKEN: TOKEN };
    if (pin !== undefined) env.WARDEN_TLS_SHA256 = pin;
    const run = await runBridge(env, [request]);
    assert.equal(run.code, 2, `pin ${pin}`);
    assert.match(run.stderr, /WARDEN_TLS_SHA256/);
    assert.equal(run.stdout, '');
  }
  assert.equal(connections, 0);
});

test('plain http to a LAN address makes the bridge exit 2', async () => {
  const run = await runBridge({ WARDEN_URL: 'http://192.0.2.10:8053/mcp', WARDEN_TOKEN: TOKEN });
  assert.equal(run.code, 2);
  assert.match(run.stderr, /not loopback/);
});
