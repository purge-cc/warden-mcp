# When the host changes

What agents and their credentials need after the configuration is restored on another host, the certificate changes, or the address changes.

Every `warden` command in this topic is for the operator, on the Warden host. You have tools only and no shell there. Give each command to the operator as text and never run it.

An agent that can no longer connect after a host change cannot repair it. The agent client holds three values in its `.env` block or plugin settings: `WARDEN_URL`, `WARDEN_TOKEN` and `WARDEN_TLS_SHA256`. Ask the operator which one changed: the address or port (URL), a replaced credential (token) or a new certificate (fingerprint). The `problems` topic lists the errors.

## The configuration is restored on another host

A config backup holds the credential table. It holds the hash of each secret, never the secret. A restore on another host therefore turns agent access on there with the same credentials, and each agent's old secret still works there until the operator replaces it.

After the restore, `warden status` on the new host warns, in these words:

```
agent credentials came back from a restore on DAY: NAMES; if this is a new host, replace them (`warden credential replace NAME`)
```

The certificate and its key are not in a backup, and a restore leaves them where they are. A new host has none. If `warden status` also says that the agent certificate does not load, the operator makes one first. Operator, on the new host:

```
warden agent cert regenerate
```

Add `--san NAME_OR_IP` for each name or address agents connect to. A specific listen address is always in the certificate. The new certificate has a new fingerprint.

Then, for each credential the status line names, operator, on the new host:

```
warden credential replace NAME
```

- It gives the credential a new id and a new secret, and keeps its level and query-log access. The old secret can change nothing at once and is refused after the reload.
- It prints a new `.env` block with the URL and the fingerprint of this host. Run it after `warden agent cert regenerate`, so the block holds the new fingerprint.
- The operator puts that block on the agent's machine, in place of the old one.

On the old host, if it keeps running, the old secrets still work there. Operator, on the old host, revokes every credential agents used:

```
warden credential revoke NAME
```

To move hosts on purpose, the steps are the same, and the agents get the new URL and the new fingerprint with the new secret.

## The certificate changes

A new certificate has a new fingerprint. Every agent client refuses the host until its `WARDEN_TLS_SHA256` holds the new value: the pin fails closed. It happens after `warden agent cert regenerate`, and when the operator swaps in their own certificate.

Operator, on the Warden host, to read the new fingerprint:

```
warden agent cert show
```

The operator then edits the `WARDEN_TLS_SHA256` line in the agent's `.env` file, or the plugin setting Certificate fingerprint (`warden_tls_sha256`), entered with `/plugin`. The token stays. If the listener served plain HTTP before a `regenerate`, it serves HTTPS from the next reload, and the `WARDEN_URL` line needs `https://` as well.

A generated certificate is valid for 3650 days. `warden status` warns 30 days before the end, and after it. Operator, on the Warden host, for a new one:

```
warden agent cert regenerate
```

On a cluster primary this can be refused: see the `cluster` topic. A certificate the operator configured is renewed by the operator, and Warden never replaces it.

## The address or port changes

Agents need the new `WARDEN_URL`. A reload applies the new address or port without a restart.

- With agent access on and the REST API off, the operator gives the new address and an existing credential name. Operator, on the Warden host:

```
warden agent enable --listen 192.0.2.20:8053 --name NAME
```

  The credential is kept and no new secret is issued.
- With the REST API on, the operator edits `[api] listen` in the config and runs `warden reload`.
- A new IP address needs a certificate that names it. After the reload the operator runs `warden agent cert regenerate`, with `--san` for each name when the listen is a wildcard. The new certificate names the address, and every agent then needs the new fingerprint. The `enable` command warns when the kept certificate does not name the new address.
- The operator edits the `WARDEN_URL` line in the agent's `.env` file, and the `WARDEN_TLS_SHA256` line if the certificate changed. The token stays.
