# Credentials

How the operator adds, lists, replaces and revokes agent credentials, and what the agent's client needs after each change.

The operator manages credentials on the Warden host. The agent has no tool for it: changing a credential is tier 3 and never goes through MCP. When a credential needs a change, the agent gives the operator the command as text. Every command block in this topic is for the operator, on the Warden host.

## What a credential is

- One credential per machine or agent. Each has its own name, secret, level and expiry date, and the operator can revoke each one alone.
- The name has 1 to 32 characters: a-z, 0-9 and hyphen.
- The secret is a token that starts with `wmc1_`. Warden keeps only a hash of it and shows the secret once, when the credential is made or replaced. A lost secret is replaced, never shown again.
- The admin token is not an agent credential. The `/mcp` endpoint refuses it.
- The level is read-only, ask-for-approval or automatic. The levels topic says what each one may do and which tools it shows.
- Query-log access (logs:read) is off unless the operator says yes when the credential is made. Without it, `search_query_log` is refused, and `check_domain` still works.
- The agent reads its own credential with `get_capabilities` (level, query-log access) and `get_status` (the same, and the expiry date). It never sees another credential.

## Add

On the Warden host, the operator runs one of these:

```
warden credential add NAME --level read-only
warden credential add NAME --level ask-for-approval --logs yes --expires 2027-01-31
```

- `--level` is read-only, ask-for-approval or automatic, and the command needs it. With automatic, the command also prints a warning that the agent applies changes itself.
- `--logs yes` or `--logs no` sets query-log access. Without the flag, the command asks on a terminal, and the default is no. With no terminal it answers no, so a script gives `--logs yes` where the credential must read the query log.
- `--expires` takes a date, the first UTC day the secret stops working, or `never`. Without it, an ask-for-approval or automatic credential and any credential with query-log access expire after 90 days. A read-only credential without query-log access does not expire.
- The command prints the secret once, inside a block of settings for the client machine. The operator saves that block there. The command also prints that tool results go to the model provider.
- When agent access is off, the command says so after the block and prints the `warden agent enable` command that turns it on and keeps this credential.
- A name that exists is refused. Replace that credential instead.

## List

```
warden credential list
```

This shows each credential with its name, id, level, query-log access, expiry date, last use and any lock. It warns when a credential expires within 14 days or has expired. `warden credential list --json` gives the same for scripts. `warden status` shows the credentials too.

## Replace: the way to rotate a secret

```
warden credential replace NAME
```

- Replace gives the credential a new id and a new secret in one step, and prints the new block for the client. The name, level and query-log access stay. From that step the old secret can change nothing. It can still read until the daemon reloads, and then it is refused.
- The expiry is set again by the rule in the Add section. An earlier date is not kept. `--expires DATE` or `--expires never` sets one.
- Use it when a secret is lost, was leaked, has expired or is about to. An expired secret gets a 401 whose text names this command. Also use it for credentials that came back from a restore on a new host: see the host-changes topic.

## Level

```
warden credential level NAME automatic
```

- The level is read-only, ask-for-approval or automatic. The command writes nothing when the credential has that level already.
- A lower level (Automatic to Ask for approval, or either of them to Read only) applies in place. The token stays the same.
- A raise (Read only to Ask for approval, Read only to Automatic, Ask for approval to Automatic) gives the credential a new secret and prints the new block once, as replace does. From that step the old secret can change nothing, and the daemon refuses it at the next reload, so the client needs the new one. The name, id, query-log access and expiry stay. A credential with no expiry, or with an expiry date that has passed, expires 90 days after the raise; `--expires DATE` or `--expires never` sets the date.
- A change to automatic prints the same warning as add.

## Revoke

```
warden credential revoke NAME
```

This deletes the credential. Its secret is refused from the reload on.

Plans of a credential that wait for the operator's approval are rejected when the credential is revoked, expires, or changes its level. `plan_status` then reads rejected, and the agent plans again if the change is still wanted.

## Change query-log access

No command changes the query-log access of a credential. The operator revokes the credential and adds it again with the new setting, which gives a new secret. A hand edit of the credential entry in the `[api]` section of the config file also works, and takes effect after `warden reload`. A hand edit of the level works the same way and keeps the secret, also for a raise: the new token comes only from the command.

## Reload

Each command above asks the daemon to reload. If a command says the reload failed, the change may not be live yet: a revoked or replaced secret can still read but can change nothing, a new credential may not work, and after a change of level the agent can change nothing until a reload succeeds. The operator reads `warden status` and the daemon log, then runs `warden reload`.

## What the agent's client needs after a change

- **Add:** save the printed block on the client machine, then connect.
- **Replace:** put the new secret in the client's `.env` file, or in the plugin with `/plugin` in a Claude Code session, then reconnect. Until then the client gets a 401.
- **A raise of the level:** put the new secret in the client's `.env` file, or in the plugin with `/plugin` in a Claude Code session, then reconnect. Until then the client gets a 401.
- **A lower level:** reconnect the client. A client keeps the tool list it got when it connected. A call to a tool that the credential no longer has fails with `not available to this credential; reconnect the MCP server to refresh the tool list`. The client-claude-code topic gives the steps for Claude Code.
- **Revoke:** the client gets a 401 and needs another credential.

After the operator changes the credential that a session uses, the agent calls `get_capabilities` again before it relies on the tools it saw earlier.

## Failed attempts lock a credential

Ten failed attempts to sign in from one address lock that credential for that address, and that address out of every credential and the REST API, for 300 seconds. The client gets HTTP 429 with a Retry-After header. A daemon restart clears the locks, and `warden credential list` shows the live ones. The problems topic lists every connection error.
