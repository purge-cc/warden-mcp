import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { createServer as createTlsServer } from 'node:tls';
import { Session, echo, makeCert, portOf, stub, type Seen } from './helpers.js';

// Every debug switch a user could turn on: Node's own, and the debug package's.
const DEBUG_ENV = { NODE_DEBUG: '*', DEBUG: '*' };

const refuse = (_s: Seen, res: ServerResponse): void => {
  res.writeHead(401, { 'WWW-Authenticate': 'Bearer error="invalid_token"' }).end();
};

async function run(env: Record<string, string>, requests: object[]): Promise<{ code: number | null; out: string }> {
  const b = new Session({ ...DEBUG_ENV, ...env });
  requests.forEach((r) => b.send(r));
  for (const _ of requests) await b.next().catch(() => undefined);
  const code = await b.end();
  return { code, out: `${b.stdout}\n${b.stderr}` };
}

test('stderr and stdout carry no token, no pin and no 8-character piece of them, with every debug flag on', async () => {
  const cert = makeCert();
  const id = randomBytes(6).toString('hex');
  const token = `wmc1_${id}_${randomBytes(32).toString('hex')}`;
  const wrongPin = randomBytes(32).toString('hex');
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } };
  const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_status', arguments: {} } };
  const outputs: string[] = [];

  // A connect: the pin matches and the server answers.
  const ok = await stub(echo, cert);
  const connected = await run({ WARDEN_URL: ok.url, WARDEN_TOKEN: token, WARDEN_TLS_SHA256: cert.pin }, [init, call]);
  ok.close();
  assert.match(connected.out, /connected to the Warden host/);
  assert.match(connected.out, /"method":"tools\/call"/);
  // The debug switches were live, so their output was part of the scan.
  assert.match(connected.out, /^(HTTP|TLS|NET) \d+:/m);
  outputs.push(connected.out);

  // A 401 on the pinned path and on the plain loopback path.
  for (const pinned of [true, false]) {
    const server = await stub(refuse, pinned ? cert : undefined);
    const env: Record<string, string> = { WARDEN_URL: server.url, WARDEN_TOKEN: token };
    if (pinned) env.WARDEN_TLS_SHA256 = cert.pin;
    const refused = await run(env, [call]);
    server.close();
    assert.match(refused.out, /HTTP 401/);
    outputs.push(refused.out);
  }

  // A pin mismatch: the server presents a certificate the pin does not match.
  const tls = createTlsServer({ key: cert.key, cert: cert.cert }, (sock) => sock.on('error', () => {}));
  tls.on('tlsClientError', () => {});
  await new Promise<void>((resolve) => tls.listen(0, '127.0.0.1', resolve));
  const url = `https://127.0.0.1:${portOf(tls)}/mcp`;
  const mismatch = await run({ WARDEN_URL: url, WARDEN_TOKEN: token, WARDEN_TLS_SHA256: wrongPin }, [call]);
  tls.close();
  assert.match(mismatch.out, /does not match WARDEN_TLS_SHA256/);
  outputs.push(mismatch.out);

  // A refused setting: the message must not echo the value it refuses.
  const bad = await run({ WARDEN_URL: url, WARDEN_TOKEN: token, WARDEN_TLS_SHA256: `${cert.pin}0` }, []);
  assert.equal(bad.code, 2);
  assert.match(bad.out, /WARDEN_TLS_SHA256 must be 64 hex digits/);
  outputs.push(bad.out);

  for (const out of outputs) {
    const lower = out.toLowerCase();
    const forms = [lower, lower.replace(/:/g, '')];
    for (const secret of [token, cert.pin, wrongPin]) {
      for (let i = 0; i + 8 <= secret.length; i++) {
        const piece = secret.slice(i, i + 8);
        assert.ok(!forms.some((f) => f.includes(piece)), `output holds "${piece}"`);
      }
    }
  }
});
