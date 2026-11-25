# Turning on agent access

How the operator turns agent access on and off on the Warden host, and the network and certificate settings that come with it.

Every command in this topic is for the operator, on the Warden host. You have tools only and no shell there. Give each command to the operator as text and never run it.

## Turn it on

Operator, on the Warden host:

```
warden agent enable --listen 192.0.2.10:8053
```

In one config write, the command sets `[api] mcp_enabled`, the listen address and `allow_from`, makes the certificate when one is needed, and adds one credential. Then it reloads the daemon. It never turns on the REST API.

- `--listen ADDR:PORT` is the only required flag. It is the address agents connect to. Port 0, port 53 and the port of `[server] listen` are refused. When the REST API is on, `--listen` must equal its `[api] listen`, because the two share one listener. This holds also when the Nodes endpoint of a cluster node is on that listener. When the REST API is off, the port of `[node] control_listen` is refused too.
- `--loopback` is required for a listen on 127.0.0.0/8 or `::1`. Only agents on the Warden host itself reach such a listen.
- `--san NAME_OR_IP`, repeatable, names the generated certificate. A listen on `0.0.0.0` or `[::]` needs at least one. For such a listen the printed `.env` block has `HOST` in the URL: the operator replaces it with an address of the Warden host that the agent can reach.
- `--allow-from CIDR[,CIDR...]` sets who may reach `/mcp`. Without it the command keeps the list already configured. With none configured, a loopback listen gets none and any other listen gets the local subnet of its address.
- `--name`, `--level`, `--logs` and `--expires` describe the first credential. The `credentials` topic explains them. Start with `--level read-only`, which is the default. A credential of that name that already exists is kept as it is, and no new secret is issued.
- `--env-file PATH` writes the `.env` block to a new file, mode 0600, instead of printing it.

The secret is printed once. A lost secret is replaced, never shown again: `warden credential replace NAME`. The block holds `WARDEN_URL` and `WARDEN_TOKEN`, and with TLS also `WARDEN_TLS_SHA256`.

## Check that it serves

Exit code 0 does not prove that `/mcp` serves. It means the config is written and a reload was sent, or nothing needed to change. Operator, on the Warden host:

```
warden status
```

The agent section shows the `/mcp` URL, the TLS mode, `allow_from` and each credential. It adds `not served; see the daemon log` when the daemon answers but does not serve `/mcp`.

## Next: the agent's machine

The operator takes the `.env` block to the agent's machine and installs the client there. The command prints both Claude Code routes: the plugin `warden-mcp@purgecc` first, then the install line, which pins the package to an exact version: `@purgecc/warden-mcp@0.1.0`. The `client-claude-code` topic holds both. The agent's machine must hold no path to the Warden host: see the `safety` topic.

## Who can reach `/mcp`

- `/mcp` checks the TCP peer against `[api] allow_from` before it looks at any token. An empty list admits the Warden host itself only. REST and the cluster routes on the same listener do not read it.
- A list that leaves out loopback does not admit an agent on the Warden host. The command says so and names `127.0.0.1/32`.
- A range outside the local network ranges (loopback, private, link-local) gets a warning from the command and from `warden status`: hosts outside the local network can reach `/mcp`. Do not put `/mcp` on the internet. To reach Warden from outside the local network, join that network through a VPN. Do not forward the port.
- The command changes no firewall rule and reads none. Off loopback, with a source in `allow_from` that is not loopback and that the listen address takes, its output holds a `Firewall:` block. The operator runs its commands as root on the Warden host, in the order shown. Each firewall command starts with `sudo` when the host has sudo. The block ends with a `Firewall guide:` line, a link to the section of the operator guide for that case. See "The firewall" below.

## The firewall

The operator runs every command in this section as root on the Warden host. The agent runs none: give them to the operator as text.

- firewalld runs: for each source, one `firewall-cmd --add-rich-rule` command without `--permanent`, which opens the port now, and one with `--permanent`, which keeps it open after a reboot or a reload. No reload is needed. Then one check for each command: the same command with `--query-rich-rule`. Each check must print `yes`.
- Warden does not read the firewall rules. It prints the same commands at each run, also when the rule is there, for example from the installer. Then the add commands print `ALREADY_ENABLED` and change nothing. The checks show what is in place.
- The rule opens the whole port to its source. When the listener also serves the REST API or the Nodes endpoint, the block says so: the source reaches those too, because `allow_from` limits only `/mcp`. If the zone already accepts the port (a port rule, a service or `target: ACCEPT`), every source reaches it.
- A loopback source gets no rule, because firewalld always accepts loopback traffic. A source of the other family gets no rule: an IPv4 listen takes no IPv6 source, a specific IPv6 listen takes no IPv4 source, and `[::]` takes both.
- A command has `ZONE`: Warden could not find the zone of that source. firewalld uses the zone whose sources hold the agent's address, else the zone of the interface the traffic comes in on, else the default zone. The operator reads them with `sudo firewall-cmd --get-active-zones` (the zone name is the first word of its line), `sudo ip route get AGENT_IP` (the word after `dev` is the interface) and `sudo firewall-cmd --get-zone-of-interface=IFACE`. Then the operator puts that zone in place of `ZONE`. With a VPN, the traffic comes in on the VPN interface. If more than one zone holds the address, or the agents of one source come in through more than one zone, the commands of that source run once for each zone.
- A check prints `no`: firewalld matches a rule by its exact text, so `192.0.2.82` and `192.0.2.82/32` are two rules. A rule in another form stays. `sudo firewall-cmd --zone=ZONE --list-rich-rules`, with and without `--permanent`, shows the rules of a zone. A `yes` shows that the rule is in that zone. It does not show that this zone gets the agent's traffic.
- Messages: `ALREADY_ENABLED` and `NOT_ENABLED` mean that the command changed nothing; the check decides. `INVALID_ZONE` means that `ZONE` is still in the command, or the zone name is wrong. `Authorization failed.` means that the command did not run as root.
- Warden cannot tell whether firewalld runs: the block starts with `sudo firewall-cmd --state`. It prints `running`, or `not running` after about 10 seconds. On `not running`, the operator runs none of the `firewall-cmd` commands of the block. Each waits about 10 seconds, then fails and changes nothing.
- firewalld is not running: the block lists the sources to allow in the firewall the host runs, if any. With ufw: `sudo ufw allow proto tcp from CIDR to any port PORT`. With nftables: `sudo nft insert rule inet filter input ip saddr CIDR tcp dport PORT accept` in the chain with `hook input` (`ip6 saddr` for IPv6), and in the nftables config file too. A firewalld rule added with `--permanent` applies again when firewalld starts. Then the `warden agent enable --listen LISTEN --name NAME` command that the block printed gives the firewalld commands. It issues no new secret while the credential NAME exists and can be used.

## The certificate

- Plain HTTP is allowed only on a loopback listen. Any other listen needs TLS.
- For a listen off loopback with no certificate configured, the command generates a self-signed certificate. It lives in `.warden-agent-tls` in the state directory, `/var/lib/purge-warden` on an installed host, and is valid for 3650 days. A config backup never carries it.
- Agents trust no certificate authority. They pin the SHA-256 fingerprint of this certificate in `WARDEN_TLS_SHA256`. A different certificate means every agent refuses the host until it has the new fingerprint.
- Operator, on the Warden host, to read the fingerprint, the end date and the names:

```
warden agent cert show
```

- `warden agent cert regenerate` makes a new certificate. The `host-changes` topic says what the agents need after it, and the `cluster` topic says when it is refused.
- A specific listen address is always in the certificate, and agents connect to that IP address: `/mcp` refuses a host name on a specific listen. A wildcard listen answers the names given with `--san`.
- An operator may set `[api] tls_cert` and `tls_key` to their own pair. Warden never replaces a certificate the operator configured. With agent access on, a key file that group or other users can access is refused.

## Turn it off, or stop one agent

Operator, on the Warden host:

```
warden agent disable
```

This sets `mcp_enabled` to false and reloads. The credentials, the certificate and `allow_from` stay, so a later `warden agent enable` reuses them and issues no new secret.

The firewall rules stay too: the command changes no firewall rule and reads none. With firewalld running, it prints the `firewall-cmd --remove-rich-rule` commands, without and with `--permanent`, after the reload line, then the checks with `--query-rich-rule`. Each check must print `no`. The operator runs them as root on the Warden host, in the order shown. A `no` shows only that the printed rule is gone from that zone. A rule in another zone, a rule in another form, a port rule or a service can still open the port: `sudo firewall-cmd --list-all-zones`, with and without `--permanent`, shows them. Warden prints commands only for the sources and the port it has now, so a rule for an old source or an old port stays. The command prints this firewall part when agent access was already off too. On a listener shared with the REST API or the Nodes endpoint, it prints no remove commands: the port stays open, because those still use it.

To stop one agent and keep the rest, the operator revokes its credential: `warden credential revoke NAME`. Both steps act at the first step of the reload, even when a later check rejects that reload.

## The installer

On a fresh install, the last step can do the same. It asks `Allow an AI agent to manage this Warden? [y/N]`, and the default is No. `--yes` alone never turns agent access on. These installer flags do it without the question: `--agent-access`, with `--agent-listen`, `--agent-allow-from`, `--agent-level`, `--agent-logs` and `--agent-expires`. `--agent-level` is read-only (the default) or ask-for-approval: the installer never makes an Automatic credential, which the operator sets later with `warden credential level agent automatic`. With the flags, the installer writes the `.env` block to a mode 0600 file in `/var/lib/purge-warden`, prints its path, and asks the operator to copy it to the agent's machine and delete it. At the question, it shows the block on the terminal instead. With the flags, it also prints the client setup lines and the data-leaves notice of `warden agent enable`, without that command's firewall part. On firewalld it opens the agent port for the `allow_from` list only. On ufw and nftables it prints the command to run. A config the installer kept, and `--upgrade`, are left as they are: the installer prints one hint line with the `warden agent enable` command to run.
