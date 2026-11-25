import assert from 'node:assert/strict';
import { createServer as createTcpServer, type Socket } from 'node:net';
import { after, before, test } from 'node:test';
import { createServer as createTlsServer } from 'node:tls';
import {
  NEVER_CONNECTS,
  PIN,
  SHORT_CONNECT,
  SHORT_IDLE,
  TOKEN,
  Session,
  echo,
  makeCert,
  portOf,
  runBridge,
  stub,
  type Cert,
  type Seen,
  type Stub,
} from './helpers.js';

const V_NEW = '2026-07-28';
const V_OLD = '2025-11-25';

let cert: Cert;
let plain: Stub;

before(async () => {
  cert = makeCert();
  plain = await stub();
});

after(() => plain.close());

function bridgeTo(url: string, pin?: string): Session {
  return new Session({ WARDEN_URL: url, WARDEN_TOKEN: TOKEN, ...(pin ? { WARDEN_TLS_SHA256: pin } : {}) });
}

function seenFor(server: Stub, method: string): Seen {
  const found = server.seen.find((s) => JSON.parse(s.body).method === method);
  assert.ok(found, `no POST for ${method}`);
  return found;
}

function call(id: number, name: string, version = V_NEW): object {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: {}, _meta: { 'io.modelcontextprotocol/protocolVersion': version } },
  };
}

test('the request reaches the server unchanged, with the bearer and content headers and no Origin', async () => {
  const server = await stub();
  const b = bridgeTo(server.url);
  const line = '{"jsonrpc": "2.0",  "id": 1, "method": "tools/list", "params": {"n": 12345678901234567890}}';
  b.send(line);
  await b.next();
  assert.equal(await b.end(), 0);
  server.close();
  const [s] = server.seen;
  assert.equal(s?.body, line);
  assert.equal(s?.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(s?.headers['content-type'], 'application/json');
  assert.equal(s?.headers.accept, 'application/json, text/event-stream');
  assert.equal(s?.headers.host, new URL(server.url).host);
  assert.equal(s?.headers.origin, undefined);
});

test('a JSON reply reaches stdout as sent, on one line', async () => {
  const body = '{\n  "jsonrpc": "2.0",\n  "id": 7,\n  "result": {"n": 12345678901234567890, "s": "a\\nb"}\n}\n';
  const server = await stub((_s, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(body));
  const b = bridgeTo(server.url);
  b.send({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
  assert.equal(await b.line(), body.trim().replace(/\n/g, ' '));
  await b.end();
  server.close();
});

test('revision 2026-07-28 headers come from each message', async () => {
  const server = await stub();
  const b = bridgeTo(server.url);
  const meta = { _meta: { 'io.modelcontextprotocol/protocolVersion': V_NEW } };
  // Claude Code opens with server/discover before any other message.
  b.send({ jsonrpc: '2.0', id: 'server-discover-probe-1', method: 'server/discover', params: meta });
  b.send(call(1, 'get_status'));
  b.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: meta });
  b.send({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'warden://guide', ...meta } });
  b.send({ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'review', ...meta } });
  for (let i = 0; i < 5; i++) await b.next();
  await b.end();
  server.close();
  for (const [method, name] of [
    ['server/discover', undefined],
    ['tools/call', 'get_status'],
    ['tools/list', undefined],
    ['resources/read', 'warden://guide'],
    ['prompts/get', 'review'],
  ] as const) {
    const h = seenFor(server, method).headers;
    assert.equal(h['mcp-protocol-version'], V_NEW, method);
    assert.equal(h['mcp-method'], method);
    assert.equal(h['mcp-name'], name, method);
    assert.equal(h['mcp-session-id'], undefined);
  }
});

test('revision 2025-11-25 headers follow the initialize result and keep the session id', async () => {
  const server = await stub((s, res) => {
    if (JSON.parse(s.body).method === 'initialize') res.setHeader('Mcp-Session-Id', 'session-1');
    echo(s, res);
  });
  const b = bridgeTo(server.url);
  b.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: V_OLD, capabilities: {} } });
  assert.equal((await b.next()).result.protocolVersion, V_OLD);
  b.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  b.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_status', arguments: {} } });
  assert.equal((await b.next()).id, 2);
  await b.end();
  server.close();
  // The notification got 202, so stdout carries only the two results.
  assert.equal(b.stdout.trim().split('\n').length, 2);
  const init = seenFor(server, 'initialize').headers;
  assert.equal(init['mcp-protocol-version'], V_OLD);
  assert.equal(init['mcp-session-id'], undefined);
  for (const method of ['notifications/initialized', 'tools/call']) {
    const h = seenFor(server, method).headers;
    assert.equal(h['mcp-protocol-version'], V_OLD, method);
    assert.equal(h['mcp-method'], method);
    assert.equal(h['mcp-session-id'], 'session-1', method);
  }
  assert.equal(seenFor(server, 'tools/call').headers['mcp-name'], 'get_status');
});

test('a version from _meta also goes on later messages that carry none', async () => {
  const server = await stub();
  const b = bridgeTo(server.url);
  b.send(call(1, 'get_status'));
  await b.next();
  b.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
  b.send({ jsonrpc: '2.0', id: 'server-1', result: {} });
  assert.equal(await b.end(), 0);
  server.close();
  assert.equal(seenFor(server, 'notifications/cancelled').headers['mcp-protocol-version'], V_NEW);
  const response = server.seen.find((s) => JSON.parse(s.body).id === 'server-1');
  assert.equal(response?.headers['mcp-protocol-version'], V_NEW);
});

test('a protocol version that is not a date is neither sent nor stored', async () => {
  const server = await stub((s, res) => {
    const m = JSON.parse(s.body);
    if (m.method !== 'initialize') return echo(s, res);
    const reply = { jsonrpc: '2.0', id: m.id, result: { protocolVersion: 'draft', capabilities: {} } };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply));
  });
  const b = bridgeTo(server.url);
  b.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'latest', capabilities: {} } });
  await b.next();
  b.send(call(2, 'get_status', '2026-7-28'));
  await b.next();
  b.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  await b.next();
  await b.end();
  server.close();
  assert.equal(server.seen.length, 3);
  for (const s of server.seen) assert.equal(s.headers['mcp-protocol-version'], undefined, JSON.parse(s.body).method);
});

test('a name that is not plain printable ASCII travels Base64-encoded', async () => {
  const server = await stub();
  const b = bridgeTo(server.url);
  const names = ['grüße', ' padded', '=?base64?abc?=', 'plain_name'];
  names.forEach((name, i) => b.send(call(i + 1, name)));
  for (const _ of names) await b.next();
  await b.end();
  server.close();
  const got = Object.fromEntries(server.seen.map((s) => [JSON.parse(s.body).params.name, s.headers['mcp-name']]));
  const b64 = (s: string): string => `=?base64?${Buffer.from(s).toString('base64')}?=`;
  assert.deepEqual(got, {
    'grüße': b64('grüße'),
    ' padded': b64(' padded'),
    '=?base64?abc?=': b64('=?base64?abc?='),
    plain_name: 'plain_name',
  });
});

test('an SSE reply is parsed across any chunk boundary', async () => {
  const progress = '{"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}';
  const stream = Buffer.from(
    `: keep-alive\n\nevent: message\nid: 1\ndata: ${progress}\n\n` +
      'event: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":5,"result":{"text":"grüße"}}\r\n\r\n',
  );
  const server = await stub(async (_s, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < stream.length; i += 3) {
      res.write(stream.subarray(i, i + 3));
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    res.end();
  });
  const b = bridgeTo(server.url);
  b.send({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
  assert.equal(await b.line(), progress);
  assert.equal(await b.line(), '{"jsonrpc":"2.0", "id":5,"result":{"text":"grüße"}}');
  await b.end();
  server.close();
});

test('an SSE event with empty data is skipped without a log line', async () => {
  const result = '{"jsonrpc":"2.0","id":6,"result":{}}';
  const server = await stub((_s, res) =>
    res
      .writeHead(200, { 'Content-Type': 'text/event-stream' })
      .end(`id: 0\ndata:\n\nretry: 1000\ndata: \n\ndata: ${result}\n\n`),
  );
  const b = bridgeTo(server.url);
  b.send({ jsonrpc: '2.0', id: 6, method: 'tools/list' });
  assert.equal(await b.line(), result);
  assert.equal(await b.end(), 0);
  server.close();
  assert.equal(b.stdout, `${result}\n`);
  assert.doesNotMatch(b.stderr, /not JSON-RPC/);
});

test('a redirect is not followed and the bearer is sent once', async () => {
  const elsewhere = await stub();
  const server = await stub((_s, res) => res.writeHead(307, { Location: elsewhere.url }).end());
  const b = bridgeTo(server.url);
  b.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const reply = await b.next();
  await b.end();
  server.close();
  elsewhere.close();
  assert.equal(reply.id, 1);
  assert.match(reply.error.message, /redirect, which the bridge never follows/);
  assert.equal(server.seen.length, 1);
  assert.equal(elsewhere.seen.length, 0);
  assert.match(b.stderr, /redirect/);
});

test('HTTP 401 and 403 give fixed texts at once, never the server text', { timeout: 10_000 }, async () => {
  for (const [status, text] of [
    [401, /HTTP 401.*warden credential replace NAME/],
    [403, /HTTP 403.*allow_from.*WARDEN_URL uses the host and port that warden credential add printed/],
  ] as const) {
    // The body never ends: the bridge must answer and exit without it.
    const server = await stub((_s, res) =>
      res.writeHead(status, { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Bearer' }).write('server-detail'),
    );
    const b = bridgeTo(server.url);
    b.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const reply = await b.next();
    await b.end();
    server.close();
    assert.match(reply.error.message, text);
    assert.doesNotMatch(b.stdout + b.stderr, /server-detail/);
  }
});

test('a JSON-RPC error with an HTTP error status passes through', async () => {
  const body = '{"jsonrpc":"2.0","id":1,"error":{"code":-32020,"message":"header mismatch"}}';
  const server = await stub((_s, res) => res.writeHead(400, { 'Content-Type': 'application/json' }).end(body));
  const b = bridgeTo(server.url);
  b.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(await b.line(), body);
  await b.end();
  server.close();
  assert.match(b.stderr, /HTTP 400/);
});

test('a reply that is not JSON-RPC becomes an error without its text', async () => {
  for (const [status, type, body, text] of [
    [500, 'text/plain', 'boom-detail', /HTTP 500/],
    [200, 'application/json', 'boom-detail', /not JSON-RPC/],
    [200, 'application/json', '"boom-detail"', /not JSON-RPC/],
    [200, 'application/json', '{"id":9,"result":"boom-detail"}', /not JSON-RPC/],
    [200, 'application/json', '{"jsonrpc":"1.0","id":9,"result":"boom-detail"}', /not JSON-RPC/],
    [200, 'application/json', '[{"jsonrpc":"2.0","id":9,"result":"boom-detail"},{"id":10}]', /not JSON-RPC/],
    [200, 'application/json', '', /no reply/],
  ] as const) {
    const server = await stub((_s, res) => res.writeHead(status, { 'Content-Type': type }).end(body));
    const b = bridgeTo(server.url);
    b.send({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
    const reply = await b.next();
    await b.end();
    server.close();
    assert.equal(reply.id, 9);
    assert.match(reply.error.message, text);
    assert.doesNotMatch(b.stdout + b.stderr, /boom-detail/);
  }
});

test('an HTTP error that is not JSON gives its status at once, without the body', { timeout: 10_000 }, async () => {
  const server = await stub((_s, res) => res.writeHead(500, { 'Content-Type': 'text/plain' }).write('boom-detail'));
  const b = bridgeTo(server.url);
  b.send({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
  const reply = await b.next();
  assert.equal(await b.end(), 0);
  server.close();
  assert.equal(reply.id, 9);
  assert.match(reply.error.message, /HTTP 500/);
  assert.doesNotMatch(b.stdout + b.stderr, /boom-detail/);
});

test('a reply body or SSE event above 16 MiB is cut off and becomes an error', async () => {
  const big = `{"jsonrpc":"2.0","id":1,"result":{"text":"${'a'.repeat(17 * 1024 * 1024)}"}}`;
  for (const [type, body] of [
    ['application/json', big],
    ['text/event-stream', `data: ${big}\n\n`],
  ] as const) {
    const server = await stub((_s, res) => {
      res.on('error', () => {});
      res.writeHead(200, { 'Content-Type': type }).end(body);
    });
    const b = bridgeTo(server.url);
    b.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const reply = await b.line();
    assert.equal(await b.end(), 0);
    server.close();
    assert.match(JSON.parse(reply).error.message, /larger than 16 MiB/, type);
    assert.ok(b.stdout.length < 1000, type);
    assert.match(b.stderr, /larger than 16 MiB/, type);
  }
});

test('a stream that ends without the reply gives an error for the request', async () => {
  const server = await stub((_s, res) =>
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end('data: {"jsonrpc":"2.0","method":"note"}\n\n'),
  );
  const b = bridgeTo(server.url);
  b.send({ jsonrpc: '2.0', id: 'a', method: 'tools/list' });
  assert.equal((await b.next()).method, 'note');
  const reply = await b.next();
  await b.end();
  server.close();
  assert.equal(reply.id, 'a');
  assert.match(reply.error.message, /no reply/);
});

test('a batch passes through as one message', async () => {
  const b = bridgeTo(plain.url);
  b.send([
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', method: 'notifications/cancelled' },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
  ]);
  const reply = await b.line();
  await b.end();
  assert.deepEqual(
    JSON.parse(reply).map((m: { id: number }) => m.id),
    [1, 2],
  );
});

test('a line that is not JSON is ignored and later lines still work', async () => {
  const b = bridgeTo(plain.url);
  b.send('not json {');
  b.send({ jsonrpc: '2.0', id: 3, method: 'ping' });
  assert.equal((await b.next()).id, 3);
  await b.end();
  assert.match(b.stderr, /not JSON; it was ignored/);
  assert.doesNotMatch(b.stderr, /not json \{/);
});

test('a refused connection gives an error for the request', async () => {
  const closed = createTcpServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = portOf(closed);
  await new Promise((resolve) => closed.close(resolve));
  const b = bridgeTo(`http://127.0.0.1:${port}/mcp`);
  b.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
  assert.match((await b.next()).error.message, /refused the connection/);
  await b.end();
});

test('stdin closed right after a request still gets the reply before the bridge exits', async () => {
  const server = await stub(echo, cert);
  const env = { WARDEN_URL: server.url, WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: cert.pin };
  const run = await runBridge(env, [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  server.close();
  assert.equal(run.code, 0);
  assert.equal(JSON.parse(run.stdout).result.method, 'tools/list');
});

test('the pinned https path forwards like plain http', async () => {
  const server = await stub(echo, cert);
  const b = bridgeTo(server.url, cert.pin);
  b.send(call(1, 'get_status'));
  assert.equal((await b.next()).result.method, 'tools/call');
  await b.end();
  server.close();
  assert.equal(server.seen[0]?.headers.authorization, `Bearer ${TOKEN}`);
  assert.match(b.stderr, /connected/);
});

test('a pin mismatch sends nothing, not even the bearer', async () => {
  let received = 0;
  const closed: Promise<void>[] = [];
  const server = createTlsServer({ key: cert.key, cert: cert.cert }, (sock) => {
    sock.on('data', (chunk: Buffer) => (received += chunk.length));
    sock.on('error', () => {});
  });
  server.on('connection', (raw: Socket) => closed.push(new Promise((resolve) => raw.on('close', () => resolve()))));
  server.on('tlsClientError', () => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const wrong = 'ef'.repeat(32);
  const b = bridgeTo(`https://127.0.0.1:${portOf(server)}/mcp`, wrong);
  b.send(call(1, 'get_status'));
  const reply = await b.next();
  await b.end();
  await Promise.all(closed);
  server.close();
  assert.equal(closed.length, 1);
  assert.equal(received, 0);
  assert.match(reply.error.message, /does not match WARDEN_TLS_SHA256, so nothing was sent/);
  for (const out of [b.stdout, b.stderr]) {
    assert.ok(!out.includes(wrong.slice(0, 8)) && !out.includes(cert.pin.slice(0, 8)));
  }
});

test('a TLS server that stalls gets the request an error, and the bridge exits', { timeout: 10_000 }, async () => {
  const server = createTlsServer({ key: cert.key, cert: cert.cert }, (sock) => sock.on('error', () => {}));
  server.on('tlsClientError', () => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const env = { WARDEN_URL: `https://127.0.0.1:${portOf(server)}/mcp`, WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: cert.pin };
  const b = new Session(env, ['--import', SHORT_IDLE]);
  b.send(call(1, 'get_status'));
  const reply = await b.next();
  assert.equal(await b.end(), 0);
  server.close();
  assert.equal(reply.id, 1);
  assert.equal(reply.error.code, -32000);
  assert.match(reply.error.message, /failed before a full reply/);
  assert.doesNotMatch(b.stderr, /handshake/);
});

test('a TCP connect that never completes names the port, not TLS', { timeout: 10_000 }, async () => {
  const env = { WARDEN_URL: 'https://127.0.0.1:1/mcp', WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: PIN };
  const b = new Session(env, ['--import', SHORT_CONNECT, '--import', NEVER_CONNECTS]);
  b.send(call(1, 'get_status'));
  const reply = await b.next();
  assert.equal(await b.end(), 0);
  assert.match(reply.error.message, /did not answer on the port in WARDEN_URL within 10 seconds/);
  assert.doesNotMatch(b.stderr, /TLS handshake/);
});

test('a server that accepts and never answers TLS gets the handshake text', { timeout: 10_000 }, async () => {
  const silent = createTcpServer(() => {});
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const env = { WARDEN_URL: `https://127.0.0.1:${portOf(silent)}/mcp`, WARDEN_TOKEN: TOKEN, WARDEN_TLS_SHA256: PIN };
  const b = new Session(env, ['--import', SHORT_CONNECT]);
  b.send(call(1, 'get_status'));
  const reply = await b.next();
  assert.equal(await b.end(), 0);
  silent.close();
  assert.match(reply.error.message, /accepted the connection but did not complete the TLS handshake within 10 seconds/);
  assert.doesNotMatch(b.stderr, /did not answer on the port/);
});
