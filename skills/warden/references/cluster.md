# Agent access in a cluster

How agent access works on the nodes of a cluster, what a secondary node refuses, and what to do when the primary role moves to another node.

Every `warden` command in this topic is for the operator, on the Warden host of the node named. You have tools only and no shell there. Give each command to the operator as text and never run it.

## The agent works on the primary

The primary holds the policy. Every change is made there and copied to the secondaries. A secondary answers DNS for its own clients with the policy it got from the primary. Agents change policy on the primary; a secondary serves reads only.

- On a secondary these tools are refused: `get_journal`, `plan`, `plan_restore`, `apply_confirmed`, `submit`, `plan_status`, `flush_cache_confirmed` and `refresh_lists_confirmed`. The journal is refused because the changes agents made are on the primary.
- The refusal reads: `this Warden node is a cluster secondary and serves reads only; connect to the primary at ADDR for changes`. Tell the operator: the client must connect to that address, with the URL, credential and fingerprint of the primary.
- The tool list depends on the credential's level, not on the node's role. An Ask for approval or Automatic credential can still list the write tools on a secondary, and calling one gets the refusal above.
- The other reads work on a secondary. `get_cluster_status` exists in cluster builds only. It gives the node's `role`, `converged` and `roster`, the list of the nodes in the cluster.
- On a secondary: `converged` is true when its last sync is current, and `peer`, `last_poll_ok` and `last_sync_secs` describe its polls of the primary.
- On a primary with enrolled members: `roster` holds this node first, then each member by name, revoked ones included. A member row has `state` (pending: enrolled, not yet active; active; revoked), `sync` (current, pending, stale or revoked; null means no confirmation since the primary started) and `online`, true only for sync current or pending. The answer also gives `policy_epoch` and `roster_age_secs`, the age of the roster read. A primary with no member shows its own row only, and `converged` reads false once `roster_age_secs` passes the stale window, 45 seconds by default.
- To read a secondary, such as its stats or its query log, the agent needs a credential of that node. The operator runs `warden credential add NAME --level read-only` on the secondary, with `--logs yes` for its query log, or `warden agent enable --listen ADDR:PORT --name NAME` there when agent access is off. With the REST API on, ADDR:PORT is the `[api] listen` of that node. The person adds that block to Claude Code as a second server with `npx`, its own server name and its own file, as the client-claude-code topic says. The plugin holds one Warden, so the second server runs beside it.
- On a secondary the operator cannot list, approve or reject agent plans. `warden agent pending`, `warden agent approve ID` and `warden agent reject ID` refuse and name the primary, because a secondary holds no pending plan.
- On a secondary, `warden agent enable` with a level other than read-only refuses and names the primary, where such a credential is created. A read-only credential works there.
- On a primary, the `receipt` of an `apply_confirmed` or `plan_status` answer carries `replication`. It reads `unknown` while a change of policy is prepared and not yet committed, or when Warden is not sure it was saved (`durability_uncertain`). It reads `pending` once the change is committed and handed to the cluster, and it stays `pending`: it never shows when the secondaries have the change; read `get_cluster_status` for that. A node outside a cluster, a plan that changes nothing, an aborted change and a rolled-back one give `not_configured`.

## Each node has its own access

`[api]` is node-local and is not replicated. Credentials, certificate and URL exist per node. A credential made on one node does not work on another, and an agent needs the URL and the fingerprint of the node it connects to.

On a primary with the REST API on, `warden agent enable --listen` must equal `[api] listen`, because the two share one listener. This holds also when the Nodes endpoint is on that listener: enable keeps its certificate, so the other nodes keep their pin.

## The certificate on a primary

On a cluster primary the API certificate is also the certificate the other nodes pin. Operator, on the primary, for a new certificate:

```
warden agent cert regenerate
```

The command refuses while the nodes reach the primary through the API listener or a Nodes operation is still running, and the message says which. `warden agent enable` refuses the same way when it would generate a certificate. Where regenerate does run, every agent's pin fails closed until its `.env` file or plugin setting holds the new fingerprint, and the `host-changes` topic gives those steps.

## When the primary role moves to another node

Warden never moves the primary role by itself. An operator moves it with the Nodes commands, such as `warden cluster create`, `warden cluster join` and `warden cluster leave`. Each of them needs a restart of the node. Afterwards the agents have to connect to the new primary:

1. The new primary has no agent credentials, because `[api]` is not replicated, and it has its own certificate. Operator, on the new primary, creates the credentials again:

```
warden credential add NAME --level read-only
```

   If agent access is not on there yet, `warden agent enable --listen ADDR:PORT --name NAME` turns it on and keeps that credential, with no second secret. With the REST API on, ADDR:PORT is the `[api] listen` of that node.
2. The command prints the `.env` block of the new primary. It holds the new `WARDEN_URL`, the new `WARDEN_TOKEN` and the new `WARDEN_TLS_SHA256`. The operator puts the block on each agent's machine, in place of the old one, or enters its values in the plugin with `/plugin`. Operator, on the new primary, to read the fingerprint again:

```
warden agent cert show
```

3. A plan that waited for approval on the old primary never applies on the new one. An approval attempt on a node that is becoming a secondary rejects the plan and names the primary. The audit record gives the reason `node_secondary`. A restart empties the list of pending plans, because it lives in memory only. The agent sees the plan as rejected, or cannot find it on the new primary. It plans again on the new primary, and submits again there.

Until the agent has the new URL, token and fingerprint, it still reaches the old node. That node now serves reads only, so its write tools are refused with the primary named.
