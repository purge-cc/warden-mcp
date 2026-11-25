import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Socket, createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import tls from 'node:tls';
import { ConnectTimeout, HandshakeTimeout, PinMismatch, connectPinned } from '../src/pin.js';
import { makeCert, portOf, tempDir, writeFile, type Cert } from './helpers.js';

let cert: Cert;
let server: Server;
let port = 0;
// Application bytes the server received, and the close of each TCP connection.
let received = '';
let closed: Promise<void>[] = [];

before(async () => {
  cert = makeCert();
  server = createServer({ key: cert.key, cert: cert.cert }, (sock) => {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => (received += chunk));
    sock.on('error', () => {});
  });
  server.on('connection', (raw: Socket) => closed.push(new Promise((resolve) => raw.on('close', () => resolve()))));
  server.on('tlsClientError', () => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = portOf(server);
});

after(() => server.close());

test('the pin form is the openssl SHA-256 fingerprint without colons, in lower case', () => {
  const dir = tempDir();
  writeFile(`${dir}/cert.pem`, cert.cert, 0o600);
  const out = execFileSync('openssl', ['x509', '-noout', '-fingerprint', '-sha256', '-in', `${dir}/cert.pem`], {
    encoding: 'utf8',
  });
  assert.equal(out.trim().split('=')[1]?.replace(/:/g, '').toLowerCase(), cert.pin);
});

test('the pinned certificate is accepted and the socket carries the request', async () => {
  received = '';
  const sock = await connectPinned('127.0.0.1', port, Buffer.from(cert.pin, 'hex'));
  sock.end('ping');
  await new Promise((resolve) => sock.on('close', resolve));
  await Promise.all(closed);
  assert.equal(received, 'ping');
});

test('another certificate is refused and the server gets no application byte', async () => {
  received = '';
  closed = [];
  const wrong = Buffer.from('ab'.repeat(32), 'hex');
  await assert.rejects(connectPinned('127.0.0.1', port, wrong), PinMismatch);
  await Promise.all(closed);
  assert.equal(closed.length, 1);
  assert.equal(received, '');
});

test('a server that accepts and never answers TLS times out as a handshake', async () => {
  const silent: TcpServer = createTcpServer(() => {});
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(connectPinned('127.0.0.1', portOf(silent), Buffer.alloc(32), 200), HandshakeTimeout);
  } finally {
    silent.close();
  }
});

// No network blackhole address: tls.connect is replaced by a socket whose TCP
// connect never completes. syncBuiltinESMExports updates the named import of
// src/pin.ts.
test('a TCP connect that never completes times out as a connect, not a handshake', async () => {
  const real = tls.connect;
  tls.connect = (() => new Socket()) as unknown as typeof tls.connect;
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      connectPinned('127.0.0.1', 1, Buffer.alloc(32), 200),
      (err) => err instanceof ConnectTimeout && !(err instanceof HandshakeTimeout),
    );
  } finally {
    tls.connect = real;
    syncBuiltinESMExports();
  }
});
