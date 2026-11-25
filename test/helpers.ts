import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  createServer as createHttpServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { Server as NetServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BRIDGE = fileURLToPath(new URL('../src/bridge.js', import.meta.url));
export const SHORT_IDLE = new URL('./short-idle.js', import.meta.url).href;
export const SHORT_CONNECT = new URL('./short-connect.js', import.meta.url).href;
export const NEVER_CONNECTS = new URL('./never-connects.js', import.meta.url).href;

export const TOKEN = `wmc1_abcdefghijkl_${'cd'.repeat(32)}`;
export const PIN = 'ab'.repeat(32);

const made: string[] = [];
process.on('exit', () => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'warden-mcp-test-'));
  made.push(dir);
  return dir;
}

export function writeFile(path: string, text: string, mode: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, mode);
}

export interface Cert {
  key: string;
  cert: string;
  // Lower-case hex SHA-256 of the certificate in DER form, the pin form.
  pin: string;
}

// A fresh self-signed certificate for 127.0.0.1, made at test time so no key
// is ever committed.
export function makeCert(): Cert {
  const dir = tempDir();
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '2']
      .concat(['-subj', '/CN=warden-mcp test', '-addext', 'subjectAltName=IP:127.0.0.1'])
      .concat(['-keyout', keyPath, '-out', certPath]),
    { stdio: 'ignore' },
  );
  const cert = readFileSync(certPath, 'utf8');
  const pin = createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');
  return { key: readFileSync(keyPath, 'utf8'), cert, pin };
}

export function portOf(server: { address(): unknown }): number {
  const addr = server.address();
  return typeof addr === 'object' && addr !== null && 'port' in addr ? Number(addr.port) : 0;
}

export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

// A running bridge with only the given variables, plus PATH and a HOME that
// holds no .env file. The Node options go before the script.
export class Session {
  stdout = '';
  stderr = '';
  readonly exited: Promise<number | null>;
  private readonly child: ChildProcessWithoutNullStreams;
  private buf = '';
  private lines: string[] = [];
  private done = false;
  private wake: () => void = () => {};

  constructor(env: Record<string, string>, nodeOptions: string[] = []) {
    this.child = spawn(process.execPath, [...nodeOptions, BRIDGE], {
      env: { PATH: process.env.PATH ?? '', HOME: tempDir(), ...env },
    });
    this.child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      this.stdout += chunk;
      this.buf += chunk;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        this.lines.push(this.buf.slice(0, nl));
        this.buf = this.buf.slice(nl + 1);
      }
      this.wake();
    });
    this.child.stderr.setEncoding('utf8').on('data', (chunk: string) => (this.stderr += chunk));
    this.child.stdin.on('error', () => {}); // the bridge may exit before it reads stdin
    this.exited = new Promise((resolve) =>
      this.child.on('close', (code) => {
        this.done = true;
        this.wake();
        resolve(code);
      }),
    );
  }

  send(msg: unknown): void {
    this.child.stdin.write(`${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n`);
  }

  // The next complete line of stdout.
  async line(): Promise<string> {
    while (this.lines.length === 0) {
      if (this.done) throw new Error(`bridge exited; stderr: ${this.stderr}`);
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
    return this.lines.shift() ?? '';
  }

  async next(): Promise<Json> {
    return JSON.parse(await this.line());
  }

  end(): Promise<number | null> {
    this.child.stdin.end();
    return this.exited;
  }
}

// Writes the lines to a new bridge's stdin, closes it and waits for the exit.
export async function runBridge(env: Record<string, string>, lines: unknown[] = []): Promise<Run> {
  const session = new Session(env);
  lines.forEach((l) => session.send(l));
  const code = await session.end();
  return { code, stdout: session.stdout, stderr: session.stderr };
}

export type Json = Record<string, any>;

export interface Seen {
  headers: IncomingHttpHeaders;
  body: string;
}

export interface Stub {
  url: string;
  seen: Seen[];
  close(): void;
}

// The default answer of the stub: a result for a request, which echoes the
// method (and the protocol version for initialize), and 202 for anything else.
export function echo(seen: Seen, res: ServerResponse): void {
  const parsed = JSON.parse(seen.body);
  const answer = (m: Json): Json | undefined =>
    m.method !== undefined && m.id !== undefined
      ? { jsonrpc: '2.0', id: m.id, result: { method: m.method, protocolVersion: m.params?.protocolVersion } }
      : undefined;
  const out = Array.isArray(parsed) ? parsed.map(answer).filter(Boolean) : answer(parsed);
  if (out === undefined || (Array.isArray(out) && out.length === 0)) {
    res.writeHead(202).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
}

// A stand-in for Warden's /mcp endpoint on 127.0.0.1, over https when a
// certificate is given. It records every POST it gets.
export async function stub(reply: (seen: Seen, res: ServerResponse) => void = echo, cert?: Cert): Promise<Stub> {
  const seen: Seen[] = [];
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      const s = { headers: req.headers, body };
      seen.push(s);
      reply(s, res);
    });
  };
  const server: NetServer = cert
    ? createHttpsServer({ key: cert.key, cert: cert.cert }, handler)
    : createHttpServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const scheme = cert ? 'https' : 'http';
  return { url: `${scheme}://127.0.0.1:${portOf(server)}/mcp`, seen, close: () => server.close() };
}
