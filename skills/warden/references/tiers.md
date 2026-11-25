# Tiers

How the server sorts a change into tier 1, 2 or 3, the reasons it gives, and the changes no agent may make.

## The rule

- The server rates every operation of a plan on its own. Then it judges the whole plan: the policy before the plan against the policy after it. The strictest finding sets the tier of the whole plan.
- A plan with nine tier 1 operations and one tier 2 operation is a tier 2 plan. A plan with one tier 3 finding is refused whole.
- Each operation keeps its tier in any plan. Splitting a change into small plans does not make its tier 2 parts tier 1.
- Anything the rules do not name is refused. When the server cannot show that a change is safe, it rates it tier 2, never tier 1.
- The plan answer gives `tier`, the `reasons` that raised it (one row per operation, or one for the whole plan), and `sent_with`, the tool that takes the plan next. This topic gives the rules and examples. Where the plan answer and this topic differ, the plan answer is right.
- The tier does not decide how a plan is carried out: the credential's level does (levels topic). When you tell the person about a plan, give its reasons, not its tier number.

## What each tier means

- **Tier 1:** the plan has no reasons. It goes the way the level sends every plan: to `submit` under Ask for approval, to `apply_confirmed` under Automatic.
- **Tier 2:** the plan has reasons. Each says what the change does that the operator should see, such as "an allow that reaches more than one device" or "a device loses deny coverage". A reason does not mean the plan waits. Under Ask for approval it waits for the operator, as every plan does. Under Automatic it applies with `apply_confirmed`, except a plan whose reasons always wait for the operator (levels topic). The operator reads the reasons when approving (approval topic).
- **Tier 3:** never through MCP, at every level, Automatic included. No tool reaches it. A plan that holds it is refused and not kept, and the refusal names the first finding. Only the operator can make such a change, by hand on the Warden host.
- A Read only credential carries out nothing, at any tier.

## Tier 1 examples

- Custom Lists: create a list, set its display name and description, add a rule for a registrable domain, replace or remove a rule, mount a list on a profile and unmount it.
- Labels of the device-type and department kinds: create them, edit them, set them on devices.
- Devices: map a device seen on the network, rename it, put it in groups or take it out, move it to another profile.
- Groups: create a group, and set its display name, priority, profile and members.
- Profiles: create a profile, and set its display name, `block_all` and list overrides.
- Subscribing to a list from the Purge catalog.
- Some restores of your own changes. The journal-restore topic says which.
- A cache flush and a list refresh, with an Automatic credential only. These take no plan: one call acts at once.

Every tier 1 example is still judged on the whole plan. One that takes filtering away from devices is tier 2 (below).

## Tier 2 examples

- The upstream DNS servers.
- Local DNS records and rewrites on a profile, except the cases under tier 3.
- Security settings: the rate limit, RRL, and tunneling detection with its exemptions.
- Log and tracking settings that apply at a reload, such as turning the query log on or off.
- Subnets and schedules: adding, changing or removing one.
- A list from an external URL.
- Unsubscribing from a Purge catalog list.
- A profile's ECS setting, block response and blocked-answer TTL.
- Setting or clearing a device's `unfiltered` opt-out.
- Deleting a list, group, profile, device or label.
- Every regex rule, and every rule with no registrable domain, such as a rule for a whole top-level domain or public suffix.
- Moving a device to a profile that answers differently: other rewrites, local records, ECS setting, block response or TTL.
- Any change in the schedules that reach a device.
- Changes the server cannot show to be safe, such as many changes to a device's MAC pin. A change the server does not model, or a rule it cannot read, waits for the operator at every level (levels topic).
- A restore that discards changes made after it. It waits for the operator at every level. The journal-restore topic has the rules.

## Taking filtering away from devices

A change that weakens a profile a device uses is tier 2:

- Any device that would lose deny coverage it has now makes the plan tier 2, whatever the number of devices. Deny coverage is a deny list, a deny rule or `block_all`. A device can lose it through its own profile, a group, its address or its MAC.
- More than one device ending the plan weaker makes it tier 2, counted over the whole plan. Weaker means the device loses deny coverage or gains an allow.
- A profile that a subnet, a schedule or the default profile setting names counts as holding more than one device. An unmapped device counts as being on the default profile.
- An allow-direction blocklist on a profile in use is tier 2, however many devices it reaches.

The repair path stays tier 1. One device may gain allow rules, each for a registrable domain, on a profile that holds no other device after the plan, as long as the device keeps every deny coverage it has now. To unblock a domain for one device: create a profile for it with the same deny coverage, add the allow rule there, and move the device onto it, in one plan.

## Tier 3: never through MCP

- Agent access itself: credentials and their levels, `mcp_enabled`, `allow_from` and the admin token.
- The cluster token hash, the audit log, and stopping the daemon.
- The `owner` label and device notes: an agent never sets them.
- A device's network name.
- A setting that the daemon applies only at a restart.
- Any change of a global local DNS record. A profile record that answers a name a global record answers. The local records, rewrites and block response of the default profile or of a profile that a subnet names.
- A subnet that leaves clients on a profile weaker than the default profile, or on a profile that answers differently from it.
- A record or rewrite for every name under a public suffix, and a tunneling exemption for a name with no registrable domain.
- A list delete that also unmounts the list from every profile.
- Any change that makes the default profile less strict (below).

There is no tool for cluster and node changes, and no tool that approves a plan.

## Guardrails

The default profile, the one unknown clients get, only gets stricter. A plan that weakens it in any way is refused whole. It is never tier 2: the operator cannot approve it through the agent, only make the change by hand. The refusals include:

- `block_all` from true to false, or a list override to allow or ignore;
- mounting a list that has allow rules on it, or adding an allow rule to a list mounted on it;
- unmounting a list that has deny rules, or removing a deny rule from a list mounted on it;
- unsubscribing from a deny list the default profile inherits;
- changing which profile is the default, or replacing or deleting the default profile.

To change filtering for one device, take the repair path above: put that device on its own profile and change that profile.

Why the default profile only gets stricter: every unknown device and every guest gets it. An agent reads names it cannot trust, such as device names and query-log rows. An agent that such text steered must not be able to open the whole network.

There are two ways through:

- Put the device on a profile of its own, as the repair path says. Profiles do not inherit from each other. A later change to the default profile's Custom Lists, list overrides or `block_all` does not reach that profile, so the operator keeps the two in step by hand. Block lists are the exception: a profile with no override for a list uses the list's base direction, so a new subscription reaches both (object model topic).
- Ask the operator to change the default profile by hand on the Warden host. To allow a domain on a Custom List the default profile mounts, the operator runs `warden custom-list add LIST DOMAIN --allow`. That rule also reaches every other profile that mounts the list. For a new list, the operator runs `warden custom-list create LIST`, adds the rule, and then runs `warden profile mount PROFILE --custom-list LIST` with PROFILE set to the default profile.

Deletes take only unused objects: an empty group, a profile that nothing uses and that is not the default profile, an unmounted list, a label no device carries. A delete of an object in use is refused, and the refusal names what uses it. Move what uses it in one plan, then delete it in a later plan.

A plan that changes nothing is refused when it is sent with `submit`, and under Ask for approval already when it is made, so the operator is never asked to approve nothing.
