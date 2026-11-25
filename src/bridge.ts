#!/usr/bin/env node
// warden-mcp: a stdio MCP server that forwards each JSON-RPC message to the
// /mcp endpoint of a Warden host and writes the replies to stdout. It holds no
// tool logic: tools, scopes and checks stay in Warden.

import { request, type IncomingMessage } from 'node:http';
import { connect, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { ConfigError, loadConfig, type Config } from './config.js';
import { log, message, type Event } from './log.js';
import { ConnectTimeout, HandshakeTimeout, PinMismatch, connectPinned } from './pin.js';

type Json = Record<string, unknown>;

// Warden's replies are far smaller. The cap stops a broken server from filling
// the memory of the machine the bridge runs on.
const MAX_REPLY = 16 * 1024 * 1024;

class ReplyTooLarge extends Error {}

// A stack trace on stderr could quote a request header, so an unexpected
// error ends the bridge with a fixed line instead.
process.on('uncaughtException', () => {
  log('internal_error');
  process.exit(1);
});

let config: Config | undefined;
try {
  config = loadConfig(process.env, homedir());
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  log(err.event, err.detail);
  // No process.exit: on pipes that are not synchronous it can cut the line.
  process.exitCode = 2;
}
if (config) serve(config);

function serve({ url, token, pin }: Config): void {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  const path = url.pathname + url.search;
  let negotiatedVersion = ''; // from the initialize result or the last _meta, for messages that carry none
  let sessionId = ''; // only a 2025-11-25 server with sessions sends one
  let connected = false;

  function open(): Promise<Socket> {
    if (pin) return connectPinned(host, port, pin);
    return new Promise((resolve, reject) => {
      const sock = connect({ host, port });
      sock.once('error', reject);
      sock.once('connect', () => {
        sock.removeListener('error', reject);
        resolve(sock);
      });
    });
  }

  function headers(msg: Json | undefined, body: string): Record<string, string> {
    const out: Record<string, string> = {
      Host: url.host,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Content-Length': String(Buffer.byteLength(body)),
    };
    const params = obj(msg?.params);
    const meta = obj(params?._meta)?.['io.modelcontextprotocol/protocolVersion'];
    const version = meta ?? (msg?.method === 'initialize' ? params?.protocolVersion : negotiatedVersion);
    if (isVersion(version)) {
      out['MCP-Protocol-Version'] = version;
      // Notifications such as notifications/cancelled, and responses to the
      // server, carry no _meta but still need the version.
      if (meta !== undefined) negotiatedVersion = version;
    }
    if (typeof msg?.method === 'string') out['Mcp-Method'] = headerValue(msg.method);
    const name = msg && mcpName(msg);
    if (typeof name === 'string') out['Mcp-Name'] = headerValue(name);
    if (sessionId) out['Mcp-Session-Id'] = sessionId;
    return out;
  }

  // Writes one message or batch per line. A JSON text holds a line break only
  // as whitespace between tokens, so replacing it keeps the message as the
  // server sent it.
  function emit(text: string, msg: Json | undefined, pending: Set<unknown>): boolean {
    const body = text.trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return false;
    }
    const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    if (list.length === 0 || !list.every((m) => obj(m)?.jsonrpc === '2.0')) return false;
    for (const m of list as Json[]) {
      if (!('result' in m || 'error' in m)) continue;
      pending.delete(m.id);
      const version = obj(m.result)?.protocolVersion;
      if (msg?.method === 'initialize' && m.id === msg.id && isVersion(version)) negotiatedVersion = version;
    }
    process.stdout.write(`${body.replace(/[\r\n]/g, ' ')}\n`);
    return true;
  }

  async function forward(line: string, parsed: unknown): Promise<void> {
    const msg = obj(parsed);
    const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    // Requests in this POST that still need a reply; notifications and
    // responses to the server get none.
    const pending = new Set(
      list.flatMap((m) => {
        const r = obj(m);
        return r && typeof r.method === 'string' && 'id' in r ? [r.id] : [];
      }),
    );
    let failure: Event | undefined;
    let detail: number | undefined;
    try {
      // Built before the wait for the connection, in the order the messages
      // came: a later message whose connection opens first still gets the
      // version that an earlier message set.
      const head = headers(msg, line);
      const sock = await open();
      // Warden answers a tool call within 30 seconds and every SSE event
      // restarts the clock, so a minute of silence means the reply is lost.
      sock.setTimeout(60_000, () => sock.destroy());
      if (!connected) log('connected');
      connected = true;
      const res = await post(sock, head, line, path);
      const status = res.statusCode ?? 0;
      const sid = res.headers['mcp-session-id'];
      if (typeof sid === 'string' && sid) sessionId = sid;
      const type = String(res.headers['content-type'] ?? '');
      if (status >= 300 && status < 400) failure = 'redirect';
      else if (status === 401) failure = 'http_401';
      else if (status === 403) failure = 'http_403';
      else if (status !== 202 && type.startsWith('text/event-stream')) {
        await readSse(res, (data) => emit(data, msg, pending) || log('bad_reply'));
      } else if (status >= 400 && !type.startsWith('application/json')) {
        // Only a JSON-RPC error could pass, so the body is not read.
        failure = 'http_status';
        detail = status;
      } else if (status !== 202) {
        const text = await readBody(res);
        const passed =
          text !== null &&
          (text.trim() === '' ? status < 300 : type.startsWith('application/json') && emit(text, msg, pending));
        if (!passed) {
          failure = status >= 300 ? 'http_status' : 'bad_reply';
          detail = status;
        } else if (status >= 400) {
          log('http_status', status);
        }
      }
      // No connection is reused, so an unread body is dropped with the socket:
      // reading it to the end would let a host keep the request open.
      res.destroy();
    } catch (err) {
      failure = classify(err);
      connected = false;
    }
    const reason = failure ?? (pending.size > 0 ? 'no_reply' : undefined);
    if (reason) log(reason, detail);
    for (const id of pending) {
      const error = { code: -32000, message: `warden-mcp: ${message(reason ?? 'no_reply', detail)}` };
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error })}\n`);
    }
  }

  // Messages go out one POST each and in parallel, as they arrive; the bridge
  // exits once stdin closes and the last reply is written.
  createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (raw) => {
    const line = raw.trim();
    if (!line) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      log('bad_input');
      return;
    }
    void forward(line, parsed);
  });
}

// The socket is handed to the HTTP client ready-made, for https only after the
// pin matched. Node's HTTP client then never opens a connection itself, the
// path on which NODE_DEBUG=http prints the request options, headers included.
function post(sock: Socket, headers: Record<string, string>, body: string, path: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    try {
      const req = request({ method: 'POST', path, createConnection: () => sock }, resolve);
      req.on('error', reject);
      for (const [key, value] of Object.entries(headers)) req.setHeader(key, value);
      req.end(body);
    } catch (err) {
      sock.destroy();
      reject(err);
    }
  });
}

function obj(v: unknown): Json | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : undefined;
}

// A protocol version is a date. Any other value is neither sent nor stored.
function isVersion(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// The methods that carry Mcp-Name, and the parameter it repeats.
function mcpName(msg: Json): unknown {
  const params = obj(msg.params);
  if (msg.method === 'tools/call' || msg.method === 'prompts/get') return params?.name;
  if (msg.method === 'resources/read') return params?.uri;
  return undefined;
}

// rmcp's rule: a value with a leading or trailing blank, a character outside
// printable ASCII, or the look of an encoded value travels as =?base64?...?=.
function headerValue(s: string): string {
  const wrap =
    s !== '' &&
    (/^[ \t]|[ \t]$/.test(s) || /[^\x20-\x7e]/.test(s) || (s.startsWith('=?base64?') && s.endsWith('?=')));
  return wrap ? `=?base64?${Buffer.from(s, 'utf8').toString('base64')}?=` : s;
}

function classify(err: unknown): Event {
  if (err instanceof PinMismatch) return 'pin_mismatch';
  if (err instanceof ConnectTimeout) return 'connect_timeout';
  if (err instanceof HandshakeTimeout) return 'tls_timeout';
  if (err instanceof ReplyTooLarge) return 'reply_too_large';
  if ((err as NodeJS.ErrnoException | undefined)?.code === 'ECONNREFUSED') return 'connect_refused';
  return 'request_failed';
}

// The whole body, or null when the connection ended before it.
function readBody(res: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let complete = false;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REPLY) {
        res.destroy();
        reject(new ReplyTooLarge());
      } else chunks.push(chunk);
    });
    res.on('end', () => (complete = true));
    res.on('error', () => {});
    res.on('close', () => resolve(complete ? Buffer.concat(chunks).toString('utf8') : null));
  });
}

// Reads text/event-stream as it arrives: a server request, such as an
// elicitation, can come mid-stream and need an answer before the stream ends.
function readSse(res: IncomingMessage, onEvent: (data: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = '';
    let data: string[] = [];
    // Bytes read since the last event ended, so no one event can hold more
    // than the cap.
    let size = 0;
    const dispatch = (): void => {
      // A priming event holds an id and empty data: nothing to forward.
      const text = data.join('\n');
      if (text.trim()) onEvent(text);
      data = [];
      size = 0;
    };
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_REPLY) {
        res.destroy();
        reject(new ReplyTooLarge());
        return;
      }
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line === '') dispatch();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        // event:, id:, retry: and comment lines carry nothing to forward.
      }
    });
    res.on('end', dispatch);
    res.on('error', () => {});
    res.on('close', () => resolve());
  });
}
