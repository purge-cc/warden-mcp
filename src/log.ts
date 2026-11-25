// Every line the bridge writes to stderr comes from this table. MCP clients
// keep a stdio server's stderr in their own log files, so no line carries the
// token, the pin, the URL or any text received from the network: only a fixed
// event and, for some events, a number.
const EVENTS = {
  url_invalid: 'WARDEN_URL is missing or is not a URL; set it to https://HOST:PORT/mcp',
  url_credentials: 'WARDEN_URL must not hold a user name or password; the token goes in WARDEN_TOKEN',
  url_scheme: 'WARDEN_URL must start with https://, or with http:// for a loopback address',
  http_not_loopback:
    'WARDEN_URL uses http:// for an address that is not loopback; plain http is allowed only for 127.0.0.0/8 and [::1], so use https:// and set WARDEN_TLS_SHA256',
  token_missing: 'WARDEN_TOKEN is not set; use the secret that warden credential add printed',
  token_invalid: 'WARDEN_TOKEN holds spaces or characters that cannot go in an HTTP header',
  pin_missing:
    'WARDEN_TLS_SHA256 is not set; an https WARDEN_URL needs the certificate fingerprint that warden agent cert show prints on the Warden host (warden status also prints it)',
  pin_invalid:
    'WARDEN_TLS_SHA256 must be 64 hex digits (colons allowed); copy the fingerprint that warden agent cert show prints on the Warden host (warden status also prints it)',
  env_file_unreadable: 'cannot read the .env file (the file in WARDEN_ENV_FILE, or ~/.config/warden-mcp/.env)',
  env_file_symlink:
    'the .env file (the file in WARDEN_ENV_FILE, or ~/.config/warden-mcp/.env) is a symbolic link, which the bridge does not follow; put the file itself there',
  env_file_open: '~/.config/warden-mcp/.env is open to other users (mode %o); run: chmod 600 ~/.config/warden-mcp/.env',
  env_file_open_custom: 'the file in WARDEN_ENV_FILE is open to other users (mode %o); run: chmod 600 "$WARDEN_ENV_FILE"',
  env_file_mode_unchecked: 'the .env file permissions are not checked on Windows; keep it inside your user profile',
  connected: 'connected to the Warden host',
  pin_mismatch:
    'the Warden host presented a certificate that does not match WARDEN_TLS_SHA256, so nothing was sent; the fingerprint changes when the certificate is regenerated, so compare the pin with the one that warden agent cert show prints on the Warden host (warden status also prints it)',
  connect_refused: 'the Warden host refused the connection; check the address and port in WARDEN_URL and that agent access is on',
  connect_timeout:
    'the Warden host did not answer on the port in WARDEN_URL within 10 seconds; check the address, that agent access is on, and that the firewall and the network let this machine reach the port',
  tls_timeout:
    'the Warden host accepted the connection but did not complete the TLS handshake within 10 seconds; check that the port in WARDEN_URL is the agent access port',
  request_failed: 'the connection to the Warden host failed before a full reply',
  redirect: 'the Warden host answered with a redirect, which the bridge never follows; check WARDEN_URL',
  http_401:
    'the Warden host refused the token (HTTP 401): it is wrong, revoked or expired; run warden credential list on the Warden host, and replace an expired credential with warden credential replace NAME',
  http_403:
    "the Warden host refused the request (HTTP 403); check that this machine's address is in [api] allow_from on the Warden host, and that WARDEN_URL uses the host and port that warden credential add printed",
  http_status: 'the Warden host answered HTTP %d',
  bad_reply: 'the Warden host sent a reply that is not JSON-RPC; it was dropped',
  reply_too_large: 'the Warden host sent a reply or SSE event larger than 16 MiB; it was dropped',
  no_reply: 'the Warden host sent no reply to the request',
  bad_input: 'a line on stdin is not JSON; it was ignored',
  internal_error: 'internal error; the bridge stopped',
} as const;

export type Event = keyof typeof EVENTS;

export function message(event: Event, detail?: number): string {
  const text: string = EVENTS[event];
  return detail === undefined ? text : text.replace('%d', String(detail)).replace('%o', detail.toString(8));
}

export function log(event: Event, detail?: number): void {
  process.stderr.write(`warden-mcp: ${message(event, detail)}\n`);
}
