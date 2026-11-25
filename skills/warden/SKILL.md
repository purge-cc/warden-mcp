---
name: warden
description: Work with a Warden DNS filtering server through its MCP tools. Use when the user asks to read the state of a Warden server, plan or apply a policy change, set up devices and profiles, audit the network, find why a device cannot reach a service, or run a scheduled review.
---

# Warden

Warden is a DNS filtering server. Its MCP tools read its state and change its policy within the limits of one credential.

The references below are the Warden agent guide: the same text the server serves through its get_guide tool. Read the overview first and the safety topic before any change, then the topic or workflow the task needs.

## References

### Topics

- [Operator approval](references/approval.md): How a plan is submitted, how the operator approves or rejects it in Warden, and how the agent reads the outcome.
- [Claude Code client](references/client-claude-code.md): How to connect Claude Code to Warden, which setups are supported, and which Claude Code versions behave as this guide describes.
- [Agent access in a cluster](references/cluster.md): How agent access works on the nodes of a cluster, what a secondary node refuses, and what to do when the primary role moves to another node.
- [Credentials](references/credentials.md): How the operator adds, lists, replaces and revokes agent credentials, and what the agent's client needs after each change.
- [When the host changes](references/host-changes.md): What agents and their credentials need after the configuration is restored on another host, the certificate changes, or the address changes.
- [Journal and restore](references/journal-restore.md): The journal of the changes agents made, and how an agent plans the restore of one of its own changes.
- [Levels](references/levels.md): The three levels of a credential, the tools each one lists, and what Automatic does and does not protect.
- [Limits](references/limits.md): The rate limits and size budgets on agent calls and plans, and what an agent does when it reaches one.
- [Object model](references/model.md): The objects a Warden policy is built from, such as block lists, Custom Lists, profiles, groups, devices and labels, and how the server picks the rules that answer a query.
- [Naming devices](references/naming.md): The default convention for the device names an agent proposes, and the limits the server puts on a name.
- [Overview](references/overview.md): What Warden agent access is, what the agent and the operator each do, which tools the server offers, and where an agent starts.
- [Problems](references/problems.md): The errors and refusals an agent can meet when it connects or calls a tool, what each one means, and who acts on it.
- [Safety](references/safety.md): The safety rules an agent follows and what the server can and cannot enforce: plans before changes, untrusted data in tool results, data that leaves the host, access to the Warden host, and neutrality toward domains and providers.
- [Turning on agent access](references/setup-host.md): How the operator turns agent access on and off on the Warden host, and the network and certificate settings that come with it.
- [Tiers](references/tiers.md): How the server sorts a change into tier 1, 2 or 3, the reasons it gives, and the changes no agent may make.

### Workflows

- [Audit](references/audit.md): A review of a Warden server over a time window that ends in a written report and changes nothing.
- [Setup interview](references/interview.md): A first setup done as rounds of questions, each with a recommended answer, that ends in one plan for the operator to review.
- [Observe after setup](references/observe.md): A follow-up after setup that reads the devices and traffic Warden has seen and plans the changes they call for.
- [Quick setup](references/quick-setup.md): A short first setup that starts from what the operator needs and proposes lists from the catalog in one plan.
- [Scheduled review](references/scheduled-review.md): A review the client runs on a schedule, and the credential and client settings that suit a job no person may be watching.
- [Troubleshoot](references/troubleshoot.md): How to find why a device cannot reach a service, fix it with a plan, and check the fix.
