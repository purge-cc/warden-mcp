# Journal and restore

The journal of the changes agents made, and how an agent plans the restore of one of its own changes.

## The journal

`get_journal` lists the changes that agents made through MCP on this node in the last 7 days, newest first. It lists agent changes only, not the operator's own changes (made with the CLI, the TUI, REST or a hand edit). Changes of every agent credential show, each with its credential id. A cluster secondary refuses the tool: agents change policy on the primary, and the journal is there.

Read the journal at the start of a session. A new session then finds what an interrupted one left, and can finish or undo that work without the old conversation.

Each entry has these fields:

- `credential_id` and `request_id`: whose change it is, and the id its plan and apply answers also gave. Find a change by its request id: entries of one second come in no set order.
- `tier`, `level` (the level of the credential that made the change; absent on older entries), `approved` (true when an operator approved it) and `created` (when it was made).
- `operations`: what the change did, in short form.
- `complete` and `inverse_complete`: `complete` is false when the record is incomplete or was cut to fit one reply. `inverse_complete` is false when the undo operations are not complete.
- `outcome`: its state is `applied`, `not_applied` (with a reason) or `outcome_unknown`. Unknown means no record says whether the change happened. Read the current state before you act, and assume neither answer.
- `audit_pending`: true while the audit line of the change is not written yet.
- `restore`: its state is `restorable` or `not_restorable`, with a reason.

A page with more entries gives `next_cursor`: pass it as `cursor` for the next page. A cursor works once, for 10 minutes. A page can hold no entries and still give a cursor. `truncated` says that entries were left out to fit one reply, and `omitted` counts them.

## Plan a restore

`plan_restore` plans the restore of one of this credential's own changes. It needs an Ask for approval or Automatic credential.

- Pass `request_id` as the entry gives it. Pass `credential_id` too if you like. The entry must read `restorable`.
- An entry of another credential is refused with `needs_approval`, and no plan is kept. Ask the operator to restore it.
- The restore puts back what that change replaced, as a new change with its own journal entry. That entry lists no undo operations, so its `inverse_complete` is false. It reads `restorable` all the same, and can be restored in turn.
- Planning changes nothing. The answer has the shape of a plan answer: `plan_id`, `plan_hash`, `request_id`, `tier`, `sent_with`, reasons, warnings and recipients. It adds `byte_exact` and `devices_without_owner_notes`. `operations` is one line that names the point. The plan is kept for 15 minutes.
- A restore is sent with the tool that `sent_with` names, with the fields repeated as given, like any plan: `submit` under Ask for approval, `apply_confirmed` under Automatic. A submitted restore waits for the operator. The approval topic covers that, and `plan_status` shows the outcome of either.

## What a restore puts back

- A restore works field by field. Only the fields the change touched go back. A later change to another field of the same object stays.
- A list field whose order the server does not read goes back element by element: a profile's mounted lists, a device's groups, a group's devices, local DNS records and rewrite rules. Elements the change added go, elements it removed or changed come back, and every other element stays. Other list fields go back whole. A Custom List's rules go back rule by rule.
- A device's membership in a group is judged once for each pair of device and group.
- `byte_exact` is true when the files the change touched did not change after it and the change deleted no device with an owner or notes. The files then go back exactly as they were.
- A restore never writes the agent access settings (the credentials, the listener, the certificate) or the cluster token. A device's owner and notes stay as they are now. A device the change deleted comes back without owner and notes, and `devices_without_owner_notes` counts these. The operator writes them again.

## The tier of a restore

A restore takes the strictest of two tiers: the tier recorded for the change, and the tier of its own diff scored as a plan. Undoing a create is a delete, and a delete is tier 2.

- A conflict makes it tier 2. A conflict is a field that the change set and a later change set to a third value. The restore would discard that later change. The reasons say "the restore discards later changes", and the operator sees each conflict on the approval screen.
- It is also tier 2 when the journal record is incomplete or has no tier, and when the restore changes the security settings.
- A restore that discards later changes, or whose journal record is missing or incomplete, waits for the operator at every level, Automatic included: its `sent_with` is `submit` (levels topic).
- A restore that would loosen the default profile is tier 3. It is refused like a tier 3 plan, and no plan is kept. The tiers topic explains why.

## Refusals and no change

- **Nothing to put back:** a restore with no difference to write is not kept. The message says that the plan changes nothing and that the config already holds what it asks for. Tell the operator and stop.
- **The saved state is gone:** the journal keeps an entry for 7 days, but the saved state a restore needs can go sooner. The entry then reads `not_restorable` with the reason "restore point evicted" or "restore point expired". The other reasons are "rolled back", "not applied" and "outcome unknown". If the state goes between the plan and the apply, the apply is refused with the reason.
- **No reverse plan:** this version builds no reverse plan from the journal. For a change that cannot be restored, tell the operator what the change did, from its operations. If the operator wants it undone, plan the opposite change with `plan`. It goes through the tiers like any plan.
- **The config changed after the plan:** the apply is refused and changes nothing. Plan the restore again.
- **A device the change added:** if the operator wrote an owner or notes on it since, the restore would remove the device with them, and it is refused.

Config backups are a different thing. The host-changes topic covers restoring a config backup.
