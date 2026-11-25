# warden-mcp

Warden MCP: a local MCP server that connects Claude Code to the agent access
of a [Warden](https://purge.cc) DNS filter. It runs on the machine of Claude
Code, speaks MCP over stdio, and forwards every JSON-RPC message unchanged
to the `/mcp` endpoint of the Warden host. On the way it:

- adds the agent token as a bearer;
- pins the SHA-256 fingerprint of the Warden certificate, and sends nothing to
  a host whose certificate does not match;
- never follows a redirect, and refuses plain `http://` unless the address is
  loopback (`127.0.0.0/8` or `[::1]`).

It holds no tool logic. Tools, scopes and approvals stay in Warden.

## Requirements

- Warden 0.45.0 or later, with agent access on.
- Node.js 22 or later on the machine that runs Claude Code.

## What leaves the Warden host

What the agent reads through this bridge goes to the model provider that
Claude Code uses, and Claude Code may keep it: device names, profiles, lists, and the
query log if the credential allows it. Give each agent its own credential, at
the lowest level that does the job: `read-only`, `ask-for-approval` or
`automatic`.

## The three values

The bridge needs three values from the Warden host:

```
WARDEN_URL=https://192.0.2.10:8443/mcp
WARDEN_TOKEN=wmc1_...
WARDEN_TLS_SHA256=3f1a...
```

- `warden credential add NAME --level read-only` prints the token once, in
  this block. The level is `read-only`, `ask-for-approval` or `automatic`.
- `warden agent cert show` prints the fingerprint; `warden status` also shows
  it. Colons and upper case are accepted.
- An `https` URL needs the fingerprint. Without it the bridge stops before it
  opens any connection.

## Setup

Pick one form. The plugin and `npx` fetch the package from npm.

### Claude Code: the plugin

The package is also the Claude Code plugin `warden-mcp`, with the `warden`
skill. This repository is its marketplace, `purgecc`. The plugin runs
`node`, so it needs Node.js 22 or later too. In a shell:

```
claude plugin marketplace add purge-cc/warden-mcp
claude plugin install warden-mcp@purgecc
```

Or in a Claude Code session:

```
/plugin marketplace add purge-cc/warden-mcp
/plugin install warden-mcp@purgecc
```

The marketplace follows the default branch of purge-cc/warden-mcp. That branch
moves only when a release is published, and its `marketplace.json` names the
exact npm version of the bridge.

Enter the three values in a Claude Code session with `/plugin`: its dialog
masks the token. In a shell, run:

```
cat | claude plugin configure warden-mcp@purgecc --values-stdin
```

Then paste the values as one JSON object, press Enter and then Ctrl-D:

```
{"warden_url": "https://WARDEN_HOST:PORT/mcp", "warden_token": "PASTE_WARDEN_TOKEN", "warden_tls_sha256": "PASTE_FINGERPRINT"}
```

A `KEY=VALUE` block is refused: JSON only. Never pass the token with
`--config`: a command line stays in the shell history.
`claude plugin install` suggests `--config KEY=VALUE` itself; never use it
for the token.

In a session, `/plugin install` asks for the three values; `claude plugin
install` in a shell does not, so use the configure step above. The npm source
is fetched from the npm registry your npm setup uses (your default registry).

To update, run `claude plugin marketplace update purgecc`, then
`claude plugin update warden-mcp@purgecc`, then restart Claude Code. The URL,
the token and the fingerprint stay. Claude Code does not update a third-party
marketplace on its own, so run these when a new release is out.

Claude Code uses the system keychain where it has one. On Linux without a
keychain (observed with Claude Code 2.1.329) the token is in plain text in
`~/.claude/.credentials.json` (mode 0600), under `pluginSecrets`. The URL and
the fingerprint are in `~/.claude/settings.json`, under `pluginConfigs`. The
values survived a reboot. This is anthropics/claude-code issue 47955, closed
as not planned. On such a machine the plugin protects the token no better
than the `.env` file below.

To remove the plugin, run `claude plugin uninstall warden-mcp@purgecc`: it
removes the token and the values from Claude Code. Then run
`claude plugin marketplace remove purgecc`. The plugin files stay in
`~/.claude/plugins/cache/purgecc/`; they hold no secrets, delete them by hand
if you want. Revoke the credential on the Warden host with
`warden credential revoke NAME`.

If the bridge refuses to start (for example a wrong fingerprint format),
`claude mcp list` shows only "Connection closed". The reason is in the server
log under `~/.cache/claude-cli-nodejs/`, in the directory named
`mcp-logs-plugin-warden-mcp-warden`. A wrong fingerprint shows as a failed
connection that names `WARDEN_TLS_SHA256`.

### Claude Code: npx and a .env file

Put the three values in `~/.config/warden-mcp/.env`, readable by you only.
Run these two commands, paste the block, then press Enter and Ctrl-D:

```
install -d -m 700 ~/.config/warden-mcp
(umask 077; cat > ~/.config/warden-mcp/.env)
```

What you paste into `cat` stays out of the shell history. An editor can write
backup and swap files under your default umask, and some editors put them
outside this directory.

The umask applies only when the file is created: an existing `.env` keeps its
mode. Run `chmod 600 ~/.config/warden-mcp/.env` after writing it, because the
bridge refuses a file with any permission for the group or other users.

Then add the bridge to Claude Code with an exact version, never a range or
`latest`:

```
claude mcp add --scope user warden -- npx -y @purgecc/warden-mcp@0.1.0
```

Keep the token out of the Claude Code configuration: Claude Code keeps copies
of it under `~/.claude/backups/`.

## How the bridge reads its settings

- The environment wins over the file. An empty variable counts as unset.
- `WARDEN_ENV_FILE` names another file instead of the default
  `~/.config/warden-mcp/.env`. That file must exist.
- The bridge refuses a file with any permission bit for the group or other
  users (fix: `chmod 600`). It also refuses a symbolic link (not on Windows).
- The default file is always read when it exists, even when the environment
  sets all three values. A default file with a wrong mode stops the bridge
  even then: fix the mode or remove the file.
- On Windows the bridge cannot check the mode, and says so each time it reads
  the file. Keep the file inside your user profile.
- Lines are `KEY=VALUE`, with an optional `export` in front and optional
  quotes around the value. Lines that start with `#` are comments.

## Who can read the token

In every form the bridge runs as you, with the token in its environment. Any
process of the same user can read it there, for example through
`/proc/PID/environ` or `ps eww`. The plugin keeps the token in a keychain
where Claude Code has one, but that does not help here: the bridge still
gets it in its environment. A `Read(...)` deny rule protects nothing from an
agent that has a shell.

The controls that hold are on the Warden host: the level and scope of the
credential, and that approval needs the Warden host. A tier 2 plan is
approved there, and the machine that runs the agent must have no way in (see
the end of the next section).

## Two deny rules for Claude Code

They limit what the tools of Claude Code do. Add them to
`~/.claude/settings.json`:

```json
{
  "permissions": {
    "deny": ["Read(~/.config/warden-mcp/.env)", "Bash(ssh:*)"]
  }
}
```

- The first keeps the Claude Code file tools away from the `.env` file. A
  shell command can still read the file, or the token in the environment of
  the bridge.
- The second denies commands that start with `ssh`. An agent with an SSH path
  to the Warden host can run `warden agent approve` there and approve its own
  plan. A rule for one host is easy to get around (`ssh -t`, an alias, the IP
  address), so the rule names no host.

Deny rules are not a sandbox. The `ssh` rule does not stop `scp`,
`rsync -e ssh`, `/usr/bin/ssh` or `bash -c "ssh ..."`. The machine that runs
the agent must hold no SSH key, forwarded agent socket, password or sudo path
to the Warden host.

## Not supported

A direct HTTP entry, such as
`claude mcp add --transport http --header "Authorization: Bearer ..."`, has no
fingerprint pin and leaves the token in `~/.claude.json` and in Claude Code's
backups under `~/.claude/backups/`, also after `claude mcp remove`. If you
used one, revoke that credential with `warden credential revoke NAME`.

## Rotation

- **Token:** `warden credential replace NAME` on the Warden host prints a new
  token and revokes the old one in the same step. Put the new token where the
  old one was: the plugin settings or the `.env` file.
  Replace an expired credential the same way.
- **Leaked token:** `warden credential revoke NAME`.
- **Certificate:** `warden agent cert regenerate` changes the fingerprint.
  Every bridge then refuses the host, and sends nothing, until you copy the new
  fingerprint from `warden agent cert show`.

`warden credential list` shows each credential with its expiry date and last
use.

## Messages and exit codes

The bridge writes one line per event to stderr, from a fixed list. Claude Code
keeps that output in its own log files, so no line carries the token, the
fingerprint, the URL or any text from the network.

- Exit 2: a setting is missing or unsafe; the bridge stopped before any
  connection.
- Exit 1: internal error.
- Exit 0: stdin closed and every reply was written.

A request that fails gets a JSON-RPC error with code -32000 and the same text.

Two events tell a connection that did not complete from one that did not
finish its TLS handshake. Each waits 10 seconds:

- The TCP connect did not complete: "the Warden host did not answer on the port
  in WARDEN_URL within 10 seconds; check the address, that agent access is on,
  and that the firewall and the network let this machine reach the port".
- TCP connected and the handshake did not complete: "the Warden host accepted
  the connection but did not complete the TLS handshake within 10 seconds;
  check that the port in WARDEN_URL is the agent access port".

When the bridge stops on a setting, Claude Code shows only "Connection
closed" in `claude mcp list`. To read the reason with the npx form, start the
bridge by hand on the machine that runs Claude Code, with no input:

```
npx -y @purgecc/warden-mcp@0.1.0 < /dev/null
```

If the Claude Code entry sets `WARDEN_ENV_FILE`, set it the same way in front of the
command, and unset any `WARDEN_` variable your shell exports. The bridge then
reads the same settings, opens no connection and exits: with 2 and the reason
on stderr when it refuses a setting, or with 0 and no output when it refuses
none. An npm error instead of a `warden-mcp:` line means npx could not fetch
or start the bridge.

Exit 0 means the form of every setting is right. A wrong token or fingerprint
still loads; it shows on the connection, and that does not stop the bridge:
each request gets the -32000 error above. If Claude Code still shows only
"Connection closed", its entry most likely starts the bridge with other
settings or another environment than your shell.

On Windows, use cmd. If the Claude Code entry sets `WARDEN_ENV_FILE`, run
`set "WARDEN_ENV_FILE=C:\path\to\file"` first. Then run the command with
`< NUL` in place of `< /dev/null`. The bridge also prints that it does not
check the file mode; that line is not a refusal.

## Build

`scripts/build.sh` needs Node.js 22 or later, npm, `tar` and `python3`. It
installs the locked dev dependencies, builds, runs the tests and writes
`purgecc-warden-mcp-0.1.0.tgz`, the npm package, which is also the Claude Code
plugin, to `out/`. It then installs the package and checks that it starts.
`scripts/check-pinned.sh` fails when a file names the package without this
exact version.

## License

Apache-2.0. Warden itself has its own license.
