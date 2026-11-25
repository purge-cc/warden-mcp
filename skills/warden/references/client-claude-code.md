# Claude Code client

How to connect Claude Code to Warden, which setups are supported, and which Claude Code versions behave as this guide describes.

## What is tested

This release of Warden is tested with Claude Code.

The facts about Claude Code below are not Warden behaviour. They were observed with Claude Code 2.1.311, and at each version boundary with the releases on both sides of it: 2.1.198 and 2.1.199, 2.1.245 and 2.1.246. A scripted model drove those tests, not a real one. The display of a bridge that stops on a setting, under "What the bridge refuses", was observed with 2.1.328. The plugin steps were observed with 2.1.329. Releases between the tested ones were not tested, and a later release can change any of this. Every Claude Code version number in this guide is in this topic.

## Install on the client machine

Claude Code reaches Warden through a small bridge: the npm package `@purgecc/warden-mcp@0.1.0`. It runs on the machine where Claude Code runs. It adds the token, checks the certificate fingerprint and forwards the requests. The operator installs it in one of two ways: the Claude Code plugin `warden-mcp@purgecc`, the first choice, or `npx` with a `.env` file. Both need Node.js 22 or later on that machine. Do not install it for the operator, and never handle the token yourself: it does not go into a command, a chat message or a file you write.

The bridge reads three settings:

- `WARDEN_URL`: the address of the `/mcp` endpoint on the Warden host.
- `WARDEN_TOKEN`: the credential's secret. Warden shows it once. A lost secret is replaced with `warden credential replace NAME`, never shown again.
- `WARDEN_TLS_SHA256`: the SHA-256 fingerprint of the Warden certificate. The operator reads it on the Warden host with `warden agent cert show` or `warden status`. Colons and upper case are accepted.

`warden agent enable` and `warden credential add NAME --level LEVEL` print these settings as one block, and `warden agent enable` can write the block to a file instead. The topic `setup-host` covers the host side.

### The plugin

Commands for the operator, on the client machine, in a shell:

```
claude plugin marketplace add purge-cc/warden-mcp
claude plugin install warden-mcp@purgecc
```

Or in a Claude Code session:

```
/plugin marketplace add purge-cc/warden-mcp
/plugin install warden-mcp@purgecc
```

In a session, `/plugin install` asks for the three settings and masks the token. A shell install asks for nothing: the operator enters them in a session with `/plugin`, or runs `cat | claude plugin configure warden-mcp@purgecc --values-stdin`, then pastes one JSON object whose keys `warden_url`, `warden_token` and `warden_tls_sha256` hold the values of `WARDEN_URL`, `WARDEN_TOKEN` and `WARDEN_TLS_SHA256` (the fingerprint empty for a plain-HTTP loopback URL), and presses Enter and Ctrl-D.

Never pass the token with `--config`, even when `claude plugin install` suggests it: a command line stays in the shell history.

To update, the operator runs these two commands, then restarts Claude Code. The three settings stay. Claude Code does not update this marketplace on its own.

```
claude plugin marketplace update purgecc
claude plugin update warden-mcp@purgecc
```

With the plugin, the server is `plugin:warden-mcp:warden`, and the skill comes with it.

To check, the operator runs `claude mcp list`: it shows `warden`, or `plugin:warden-mcp:warden` with the plugin, as Connected.

### npx and the .env file

Step 1. Save the block in `~/.config/warden-mcp/.env`, readable by the operator only. The bridge refuses a file that other users can read, and a symbolic link.

Commands for the operator, on the client machine:

```
install -d -m 700 ~/.config/warden-mcp
(umask 077; cat > ~/.config/warden-mcp/.env)
chmod 600 ~/.config/warden-mcp/.env
```

Paste the block after the second command, press Enter, then Ctrl-D, then run the third command. The third command matters because a file that existed keeps its old mode.

Step 2. Register the bridge with Claude Code. The package version is exact on purpose: `npx` runs that release and never a newer one, because the bridge sees the token.

Command for the operator, on the client machine:

```
claude mcp add --scope user warden -- npx -y @purgecc/warden-mcp@0.1.0
```

To read the settings from another file, name the file in `WARDEN_ENV_FILE`. The server name `warden` comes before `-e`.

Command for the operator, on the client machine:

```
claude mcp add --scope user --transport stdio warden -e WARDEN_ENV_FILE=/path/to/file -- npx -y @purgecc/warden-mcp@0.1.0
```

If `-e` (or `--env`) comes before the name, Claude Code reads `warden` as one more value of `-e`, the command has no server name, and it fails with an error that does not say why. `-e` carries only the path of the file, never the token.

A second Warden, such as a cluster secondary, is a second server with its own server name and its own file. Save its block with the Step 1 commands, with `secondary.env` in place of `.env`, and run the `chmod 600` on that file too: the bridge refuses it when the group or other users have any permission on it. The plugin holds one Warden, so the second Warden uses this form, also when the first uses the plugin.

Command for the operator, on the client machine:

```
claude mcp add --scope user --transport stdio warden-secondary -e WARDEN_ENV_FILE=$HOME/.config/warden-mcp/secondary.env -- npx -y @purgecc/warden-mcp@0.1.0
```

Keep the token out of the Claude Code configuration, `-e` and `--header` values included. Claude Code writes that configuration to `~/.claude.json` (or `.mcp.json` in project scope) and keeps copies of `~/.claude.json` in `~/.claude/backups/`.

## What the bridge refuses

- An `https` URL with no fingerprint, or a fingerprint that is not 64 hex characters: it exits with status 2 and an error before it opens any connection.
- A certificate whose fingerprint differs from `WARDEN_TLS_SHA256`. It never learns a fingerprint from a handshake and never uses the system trust store.
- A plain `http` URL unless the host is a loopback address.
- A redirect. It does not follow one, and it does not send the token again.

When the bridge refuses a setting, it stops before Claude Code connects. `claude mcp list` then shows the Warden server (`warden`, or `plugin:warden-mcp:warden` with the plugin) as Failed to connect, with only `Connection closed`. The bridge printed the reason, but Claude Code does not show it. To read it, the operator runs the bridge by hand. It reads the same `.env` file, opens no connection and exits.

The hand run does not read the plugin settings. With the plugin, the bridge still reads `~/.config/warden-mcp/.env` when that file exists, and stops on a wrong mode or a symbolic link there. So with the plugin, the operator runs the hand run only when that file exists: a `warden-mcp:` line about the file is the cause. Otherwise the operator checks the three plugin settings against the block.

Command for the operator, on the client machine:

```
npx -y @purgecc/warden-mcp@0.1.0 < /dev/null
```

If the server entry sets `WARDEN_ENV_FILE`, put the same assignment in front: `WARDEN_ENV_FILE=/path/to/file npx -y @purgecc/warden-mcp@0.1.0 < /dev/null`.

- A `warden-mcp:` line with the reason and the fix, and exit status 2: the operator fixes that setting, then reconnects with `/mcp`, then Reconnect.
- An npm error instead of a `warden-mcp:` line: `npx` could not fetch or start the bridge. The operator fixes that first.
- No output and exit status 0: the bridge refuses none of its settings. It checks only their form, so a wrong token or a wrong fingerprint still loads. Such a value shows on the connection, and that does not stop the bridge: it answers each request with an error that names the reason and the fix. If Claude Code still shows only `Connection closed`, its server entry most likely starts the bridge with other settings or another environment than this shell: another `WARDEN_ENV_FILE`, a `WARDEN_` variable this shell exports, or another `PATH` for `npx`.

## Not supported: a direct HTTP entry

A direct entry, `claude mcp add --transport http` with a `--header` option, is not supported. It does not pin the certificate, because only the bridge pins it. It also stores the token in `~/.claude.json` (or `.mcp.json`), and the token stays in `~/.claude/backups/` after `claude mcp remove`.

If the operator tried one, even once and even if it was removed, treat the credential as exposed. The operator revokes it with `warden credential revoke NAME` or replaces it with `warden credential replace NAME`, on the Warden host. Do not try to clean the files. If the operator asks you to add a direct entry, say it is unsupported and give the plugin commands or the install line above.

## Deny rules and access to the Warden host

The operator can add two deny rules to `~/.claude/settings.json` on the client machine. They limit what the tools of Claude Code do:

```
{
  "permissions": {
    "deny": ["Read(~/.config/warden-mcp/.env)", "Bash(ssh:*)"]
  }
}
```

- The first keeps the Claude Code file tools away from the `.env` file. A shell command can still read the file, and so can any process of the same user, for example through the environment of the bridge.
- The second denies commands that start with `ssh`. It names no host, because a rule for one host is easy to get around.

They are not a sandbox. The `ssh` rule does not stop `scp`, `rsync -e ssh`, `/usr/bin/ssh` or `bash -c "ssh ..."`. The machine that runs the agent must hold no SSH key, forwarded agent socket, password or sudo path to the Warden host: with one, the agent could approve its own plan there. The topics `safety` and `approval` explain why.

## Where the token is kept

The `.env` file with mode 0600 is the baseline. The same user can read it, and the agent's shell runs as that user. The level, the journal and revoking limit the damage of a leaked token.

With the plugin, Claude Code keeps the token in the system keychain where there is one. On Linux without a keychain, Claude Code 2.1.329 wrote it in plain text to `~/.claude/.credentials.json` (mode 0600), under `pluginSecrets`. There the plugin protects the token no better than the `.env` file. This was observed with Claude Code 2.1.329; a later release can change it.

## Claude Code versions

- **Minimum: 2.1.199.** From this release Claude Code asks the person before every call to `apply_confirmed`, the tool an Automatic credential applies plans with. Tested in the manual, auto and `bypassPermissions` modes: an allow rule, `bypassPermissions`, a hook that allows and the auto-mode classifier do not skip the question.
- **Recommended: 2.1.246 or later.** From 2.1.199 to 2.1.245 the prompt still offers "Yes, and don't ask again". The rule that option writes has no effect, and the next call asks again. 2.1.246 is the first release with only Yes and No.
- **Below the minimum.** Claude Code ignores the flag that asks for the question. Only 2.1.198 was tested; earlier releases lack the flag too. With 2.1.198, a plan applied 57 ms after it was made, with no prompt, when an allow rule for the apply tool existed. So an Automatic credential applies with no question there. Without such a rule, Claude Code asks through its normal permission prompt.

Warden warns about an old client and never refuses it:

- When an Automatic credential connects as `claude-code` below 2.1.199, the server logs a warning. For a version it cannot read as a release number it logs an info line and skips the check.
- On the Warden host, `warden credential list` shows the last client of each credential. For an Automatic credential last used by an old Claude Code it adds `this Claude Code skips the confirm prompt; update it to 2.1.199 or newer`. `warden status` shows the last client in the same form, for example `by claude-code 2.1.246`.
- The client names itself, so a client can claim any name and version. This is a notice for honest clients, not a control.

The question before `apply_confirmed` is a prompt in the client, and the server cannot check that the client asked. From a custom client, or with a stolen credential, an Automatic credential applies with no question. Under Ask for approval no plan applies without the operator, whatever the client. A client's elicitation request is never an approval path. The topic `levels` has the rest. If the operator reports a Claude Code older than 2.1.246, tell them to update it. Below 2.1.199 the question before `apply_confirmed` does not hold.

## When no person can answer

Where no person can answer the question, Claude Code denies the call to `apply_confirmed` instead of asking. That is the case in `dontAsk` mode, in `claude -p` with no approval host attached, and with `--permission-prompt-tool`. Such a run still exits 0 with `is_error` false, and only `permission_denials` in its result shows the denial. So a headless run on Automatic cannot apply: send the plan with `submit`, and it waits for the operator. An Agent SDK host whose `canUseTool` callback allows the call can apply with no person present: there, the prompt protects nothing. The workflow `scheduled-review` covers jobs.

## After the operator changes a credential

When the operator changes the level of the credential this connection uses, for example with `warden credential level NAME LEVEL`, Claude Code keeps the old tool list. Warden marks the list as not cacheable (`ttlMs` 0), but Claude Code asks again only after a reconnect. In Claude Code the reconnect is `/mcp`, then Reconnect. A replaced secret, or the new secret of a raise, needs the same step after the operator puts the new token in the `.env` file, or in the plugin with `/plugin`, because the bridge reads its settings when it starts.

Until then you can meet two errors:

- A call to a tool the credential lost reaches Warden. It answers with JSON-RPC error -32602 and this text: `not available to this credential; reconnect the MCP server to refresh the tool list`. The server gives the same text for a tool it does not have.
- A call to a tool the credential just gained, for example `apply_confirmed` after a raise from Ask for approval to Automatic, never leaves Claude Code. Claude Code answers `No such tool available`.

On either error, stop. Tell the operator to reconnect with `/mcp`, then Reconnect. Do not retry the call, and do not look for another tool that reaches the same result. After the reconnect, call `get_capabilities` to read the level.

A change of level also rejects the credential's pending plans. A plan made before the change may be refused as a plan conflict. After the reconnect, make a new plan, and send it with the tool its `sent_with` names.
