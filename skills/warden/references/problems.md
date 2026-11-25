# Problems

The errors and refusals an agent can meet when it connects or calls a tool, what each one means, and who acts on it.

The agent has no shell on the Warden host. A fix that the tables give to the operator is made on that host, and the agent gives the operator the command as text. The person is whoever looks after the client machine: its settings, the saved block of connection values and the client's connection to the server.

First look at any connection problem: the operator runs `warden status`. Its agent section says whether agent access is on, at which URL, whether the server answers there, the certificate fingerprint, the sources it admits, and each credential with its expiry. The daemon log holds the reason for each refusal.

## When the client cannot connect

The client shows these as connection or sign-in errors, before any tool call.

| What the client gets | What it means | Who acts |
|---|---|---|
| Claude Code shows Failed to connect with only "Connection closed" | The bridge stopped before it connected, most often because it refused one of its settings. Claude Code does not show the reason the bridge printed. | Person: runs the bridge by hand, as the client-claude-code topic says under "What the bridge refuses", and fixes what it names. The hand run does not read the plugin settings: with the plugin, the same topic says when it helps. |
| Failed to connect with "the Warden host did not answer on the port in WARDEN_URL within 10 seconds" (in Claude Code after `-32000: warden-mcp:`) | No TCP connection was made within 10 seconds. A firewall on the Warden host or on the network path drops the packets, or `WARDEN_URL` names an address or port where the packets go unanswered. | Operator: `warden status` shows the daemon running and the agent line on, with no `not served` note; if not, the setup-host topic turns agent access on and the daemon log gives the reason. Operator: runs as root the `--query-rich-rule` checks that `warden agent enable` printed; each must print `yes`; if not, the setup-host topic, section "The firewall", and the `Firewall guide:` line of that output say what to do. Person: the host and port in `WARDEN_URL` are the ones in the saved block, and a TCP probe of that port connects, for example `nc -vz -w 10 HOST PORT`. Operator: if the probe fails while these checks pass, another rule may drop the traffic. On the Warden host, `sudo firewall-cmd --zone=ZONE --list-rich-rules`, with the zone of those checks, lists the rules of that zone. firewalld applies a drop rule before an accept rule unless a rule sets a priority, so a rule that drops the client's address wins: the operator removes it or narrows it. With no such rule, suspect a filter between the two machines; whoever runs that network opens the port. |
| Failed to connect with "the Warden host accepted the connection but did not complete the TLS handshake within 10 seconds" (in Claude Code after `-32000: warden-mcp:`) | The TCP connection was made, but no TLS handshake followed within 10 seconds. The port in `WARDEN_URL` most likely belongs to another service, not to agent access. | Person: the host and port in `WARDEN_URL` are the ones in the saved block. Operator: `warden status` shows the agent URL; its port must be the port in `WARDEN_URL`. If they match, the operator checks that nothing between the two machines, such as a port forward, sends that port to another service. |
| Failed to connect with "the connection to the Warden host failed before a full reply" (in Claude Code after `-32000: warden-mcp:`) | The connection broke before the Warden host sent a full reply. When the error comes at once, the usual cause is a firewall on the Warden host that rejects the packets: in most zones, firewalld rejects a connection to a port that no rule opens. The daemon stopping or restarting during the request gives the same text. | Operator: `warden status` shows the daemon running and the agent line on, with no `not served` note. Operator: runs as root the `--query-rich-rule` checks that `warden agent enable` printed; each must print `yes`; if one prints `no`, runs the add commands of that output. The setup-host topic, section "The firewall", and the `Firewall guide:` line of that output say the rest. Person: the host and port in `WARDEN_URL` are the ones in the saved block; a TCP probe of that port, for example `nc -vz -w 10 HOST PORT`, fails at once (on Linux with "No route to host") when a firewall rejects it. Operator: if the probe fails while the checks print `yes`, the rule is most likely in a zone that does not get the client's traffic, or a `reject` rule for the client's address comes first: the setup-host topic, section "The firewall", says how to find the zone, and `sudo firewall-cmd --zone=ZONE --list-rich-rules` lists the rules of a zone. |
| HTTP 404 | Agent access is off on this host, or the URL is not the one the operator's block gives. | Operator: `warden status`. The setup-host topic turns agent access on. |
| HTTP 401, no text | The token is missing, is not a credential token (the admin token is refused), names a credential that does not exist any more, or has the wrong secret. A revoked or replaced credential reads the same. | Person: check the saved block. Operator: `warden credential list`. A lost secret is replaced (credentials topic). |
| HTTP 401 with `error="invalid_token"` and the text "credential expired; on the Warden host run: warden credential replace NAME" | The secret is right and the credential has expired. | Operator: runs the command named in the text. Person: saves the new block and reconnects. |
| HTTP 429 with Retry-After | Either 10 failed sign-ins locked this credential for this address (credentials topic), or the credential sent too many requests in a minute. Retry-After gives the seconds to wait. | Wait that long. Person: fix the secret if sign-ins failed. |
| HTTP 503 with Retry-After | Too many requests at once. | Person: have the client send fewer at a time, and try again. |
| HTTP 403 | The source address is not in the sources agent access admits, or the host in the URL is not one the listener answers, or the request carries an Origin header, as a browser sends. | Operator: `warden status` shows the sources. Person: use the URL from the block, with no browser in between. |
| HTTP 400, 413 or 415 | The client sent a message that is malformed or over 1 MiB. | Person: a fault in the client software. |
| A message that the certificate does not match WARDEN_TLS_SHA256, or that WARDEN_TLS_SHA256 is not set (in Claude Code, a missing pin shows as the "Connection closed" row above) | The client pins the server's certificate. The pin is missing, or the certificate changed, for example after `warden agent cert regenerate`. | Operator: `warden agent cert show` prints the fingerprint. Person: puts it in the saved block and reconnects. |
| The client cannot connect right after `warden agent enable` | An exit code 0 of that command does not prove that `/mcp` is served. | Operator: reads `warden status` and the daemon log. |

## When a tool call fails

A tool error is a tool result marked as an error, with a `code` and a `message`. The one exception is `-32602`, a protocol error with only a text. The message is the part to match when you are unsure.

| What you read | What it means | What to do |
|---|---|---|
| `-32602`: "not available to this credential; reconnect the MCP server to refresh the tool list" | This credential has no such tool, or the client holds a tool list from before the operator changed the credential. One text covers both. | Agent: do not retry. Call `get_capabilities` to see what this credential has. If the level changed, the person reconnects the client. |
| `logs_not_granted`: "this credential lacks logs:read; ..." | The credential has no query-log access. The operator sets that when the credential is made. | Agent: ask the operator for the domain and use `check_domain`, which needs no query-log access. Operator: adds a credential with query-log access if the log is needed. |
| `secondary_read_only`: "this Warden node is a cluster secondary and serves reads only; connect to the primary ..." | The client is connected to a secondary node. | Person: connect to the primary, with its own URL, credential and fingerprint (cluster topic). |
| `rate_limited` | A limit on applies, or on cache flushes and list refreshes, is reached. The message says when the next call is free. | Agent: stop, tell the operator, and do not retry before that time. Read a change you sent with `plan_status` instead of sending it again (limits topic). |
| A message that says the credential holds plans it has not applied, or has plans waiting for the operator's approval | The limit on open plans is reached. | Agent: apply or drop the plans you hold. Ask the operator to approve or reject the waiting ones. |
| `invalid_argument` | An argument is wrong, or the plan changes nothing. The message says what to fix. | Agent: fix it. Never send the same call again. |
| `invalid_request`: "this plan holds a change no agent may make, so Warden did not keep it ..." | The plan has a tier 3 change. The message names the first one. | Agent: leave it out and tell the operator that it is theirs to make (tiers topic). |
| "this plan needs the operator: ... Send it with submit." | `apply_confirmed` was called for a plan whose reasons always wait for the operator, also under Automatic (levels topic). The refusal does not count against the hourly limit. | Agent: send the same plan with `submit` and tell the operator how to approve it (approval topic). |
| `transport_limit_exceeded` | The plan, or one of its entries, is over the size limit of one change. | Agent: split the plan. |
| `corpus_ceiling` | The lists in the plan may push the domain count past the ceiling, and the next refresh would then be refused. Warden did not keep the plan. | Agent: plan fewer or smaller lists. Operator: may raise `max_total_domains` first. |
| `needs_approval` | `plan_restore` was asked for another credential's change. | Agent: ask the operator to restore it. |
| A message that ends "Make a new plan with the plan tool, or a new restore plan with plan_restore." or `tree_changed` | The stored plan is gone or no longer matches: it expired, the config changed, or the policy files changed during the check. | Agent: make a new plan from the current state. Do not send the old one again. |
| "this credential was revoked, expired, replaced or changed its level in the config, so nothing changed" | The operator changed the credential after the plan was made, or gave it a new token. | Agent: tell the operator. Plan again after the person has reconnected the client. |
| `daemon_error`, `storage_unavailable`, `recovery_required`, `admission_rejected` or `outcome_unknown` | Warden could not finish the call. It may be busy, its storage may be unreachable, or an interrupted change may need recovery. | Agent: try again later. If it keeps failing, ask the operator to check the Warden log. If you sent a change, read its state with `plan_status` before you send it again. |

## When a submitted plan ends without applying

`plan_status` gives the state of a plan the agent submitted for the operator's approval. These three states mean that nothing changed.

| State | What it means | What to do |
|---|---|---|
| `rejected` | The operator rejected the plan, or its credential was revoked, expired, replaced with a new token or changed its level, or the node became a secondary. | Agent: tell the operator. Plan again if the change is still wanted. |
| `expired` | The plan waited 24 hours without approval. | Agent: plan again if the change is still wanted. |
| `stale` | The operator approved the plan, but it no longer applied as it stood. | Agent: plan again from the current state. |

## A tool the guide names is missing

The tools in the list depend on the credential's level (levels topic). `get_cluster_status` exists only in a build with clustering. Call `get_capabilities` to see what this credential has.
