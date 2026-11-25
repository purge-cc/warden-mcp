# Overview

What Warden agent access is, what the agent and the operator each do, which tools the server offers, and where an agent starts.

## What this is

Warden is a DNS filtering server. Agent access lets an AI agent read the state of one Warden server and change its policy through MCP tools, within the limits of one credential. The operator is the person who runs the Warden host and made the credential.

## Who does what

- You are the agent. You have tools and nothing else: no shell on the Warden host.
- You never run `warden` commands. Every `warden` command in this guide is for the operator, who types it on the Warden host. When one is needed, give it to the operator as text and say what it does.
- The operator turns agent access on and off, creates, replaces and revokes credentials, and approves or rejects the plans that need approval. The operator approves with the CLI or in the TUI, on the Warden host. You cannot approve a plan.
- You read the state, plan changes, apply or submit each plan as its answer says, and read what became of them.

## Where to start

1. Call `get_capabilities`. It gives this credential's level, what it may change and how, and its query-log access. The tools you see depend on them.
2. Read the safety topic before any change.
3. Call `get_guide` with no topic. It lists every topic and workflow with a one-line summary. Call it again with `topic` set to one name to read that one.
4. Read the state before you plan: `get_status`, `list_devices` and `list_policy_objects` show what is there.

Where a tool answer and this guide differ, the tool answer is right. In particular, the `sent_with` in a plan answer names the tool that takes that plan.

## The tools

- Meta: `get_capabilities` and `get_guide`.
- Read state: `get_status`, `get_stats`, `list_devices`, `list_policy_objects`, `list_blocklists`, `list_custom_lists`, `get_custom_list_rules`, `list_catalog` (the Purge catalog), `get_journal` (the changes agents made) and `get_cluster_status` (this node's cluster view).
- Ask the policy: `check_domain` says whether Warden would block a domain, for one client address or under the default profile.
- Read the query log: `search_query_log`. Every credential lists it, and it works only when the operator granted query-log access.
- Change policy, with an Ask for approval or Automatic credential: `plan` stages a change and `plan_restore` stages the undo of one of your own changes. Neither changes anything. `submit` sends a plan to the operator, `apply_confirmed` applies one, and `plan_status` shows what became of it.
- Act in one step, with an Automatic credential and no plan: `flush_cache_confirmed` and `refresh_lists_confirmed`.

A Read only credential shows no tool that changes anything. An Ask for approval credential shows the plan tools and `submit`. An Automatic credential also shows `apply_confirmed`, `flush_cache_confirmed` and `refresh_lists_confirmed`. The levels topic has the detail. On a cluster secondary some tools are refused; the cluster topic says which.

## Data leaves this host

Data leaves this host: tool results go to the model provider, and the client may keep them. The safety topic says what that means for you.

## The other topics

- model: the objects a policy is built from, and how a query gets its verdict.
- naming: how to name a device.
- tiers, levels, approval, limits: the reasons a change gets and the changes no agent may make, what each credential may do, how the operator approves, and what is rate limited.
- credentials, journal-restore, problems: credentials, undoing your own changes, and what an error means.
- client-claude-code, setup-host, cluster, host-changes: connecting a client, turning agent access on, clusters, and a moved host.
- Workflows: interview, quick-setup, observe, audit, troubleshoot and scheduled-review are step-by-step plans for the usual jobs.
