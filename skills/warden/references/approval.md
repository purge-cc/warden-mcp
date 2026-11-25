# Operator approval

How a plan is submitted, how the operator approves or rejects it in Warden, and how the agent reads the outcome.

## The agent's part

1. Make the plan with `plan`, or with `plan_restore` for a restore. When the answer has `sent_with` set to `submit`, the plan waits for the operator: every plan does under Ask for approval, and under Automatic a plan whose reasons always wait (levels topic). Its `reasons`, when it has any, say what the operator should look at.
2. Send it to `submit` within 15 minutes, with `plan_id`, `plan_hash`, `request_id`, `operations` and `affected_profiles` exactly as the plan answer gave them. Submitting changes nothing.
3. The answer gives `pending_id`, the approval command for the operator in `approve_with` (`warden agent approve` followed by that id), the place in the TUI in `approve_in_tui` (Configuration › Agents, the agent's Approvals), and when the plan expires.
4. Tell the operator in plain words what the plan changes, its reasons, and both ways to approve it: in the TUI, or with the command. Give the command as text. Never run it, and never try to reach the Warden host.
5. Wait for the operator. Then read the outcome with `plan_status` and the `pending_id`. Do not call it in a loop while the operator decides.

What `plan_status` gives for a submitted plan:

- **pending:** the plan still waits for the operator.
- **rejected:** the operator rejected it, its credential changed, or the node is becoming a cluster secondary. Nothing changed. Do not submit it again unless the operator asks.
- **expired:** 24 hours passed with no approval. Nothing changed. Ask the operator before you submit it again.
- **stale:** the operator approved it, but it no longer applied as it stood. Nothing changed. Read the state again and make a new plan.
- **a receipt:** the operator approved it and Warden took the change in. The receipt says whether it committed.

If `plan_status` no longer finds the plan, read `get_journal`: the `pending_id` is the plan's `request_id`, and an entry with it gives the outcome of the change. If there is none, plan the change again only if the operator still wants it.

Rules for the agent:

- Submit each plan once. A resend with the same `request_id` after a lost reply gives the first answer back and does not count. A new submission of the same change is a new pending plan, and it counts against the hourly limit.
- A credential holds at most 5 pending plans. A sixth is refused: it never replaces an older one. Wait for the operator.
- No tool approves a plan, and nothing on the agent connection can approve one, an elicitation answer included. Approving is the operator's act.

## In daily use

- Put related changes in one plan. The operator approves them together, and one plan cannot go stale against the others.
- Do not submit a second plan on the same list or profile while one waits. Approving the first changes the objects the second touches, so the second ends stale and applies nothing.

## The operator's part

Commands for the operator, on the Warden host:

```
warden agent pending
warden agent approve ID
warden agent reject ID
```

- `warden agent pending` lists each waiting plan with its approve and reject commands, then the recent agent events, newest first.
- `warden agent approve ID` shows the plan, then asks the operator to type yes. The screen gives the operation count, the devices and lists whose deny coverage changes, why the plan needs approval, the affected profiles, and every operation in full, one per line. Names and agent text are printed escaped, so a hidden character cannot pass for something else.
- Any answer other than yes approves nothing.
- `warden agent approve` needs a terminal: without one it refuses and sends nothing. It has no `--yes` flag. The question is in this command only: a program that runs as the daemon's user can send the approval straight to the daemon's socket and is asked nothing (see below).
- `warden agent reject ID` rejects the plan. Nothing changes, and the agent reads the plan as rejected.
- In the TUI on the Warden host, the operator approves or rejects a plan under Configuration › Agents, the agent's Approvals. The approval shows the same plan and asks for yes typed in full.
- These commands reach the daemon over its local socket, never over the agent connection. On a cluster secondary they refuse and name the primary: approve there.

Exit status of `warden agent approve`:

- 0: the plan was applied.
- 1: nothing was applied: not approved, refused, aborted, or the daemon could not be reached.
- 2: the config did not load, so nothing was sent.
- 6: the outcome is unknown. Check the policy journal before planning the change again.

## What ends or changes a pending plan

- A submitted plan is frozen: its operations, its credential with that credential's level, and the state of the objects it touches.
- If those objects changed after the submission, by the operator or by another approved plan, the approval applies nothing and the plan ends stale. The agent makes a new plan.
- If the plan would now do something other than what the operator was shown, the approval applies nothing. When Warden can show the new effect, the plan keeps waiting with it: the operator reads it again with `warden agent pending` and approves again if they agree. Otherwise the plan ends stale.
- If Warden is busy, its storage is unavailable, or the config changed while it checked, the approval applies nothing and the plan keeps waiting. The operator approves again later.
- A revoke, an expiry, or a change of level of its credential rejects the plan.
- A pending plan ends 24 hours after its submission. An approval after that is refused.
- A restart of Warden empties the store of pending plans, because it lives in memory.

## The terminal check is not the boundary

- The terminal check only prevents accidents. A pseudo-terminal passes it. With an SSH key to the Warden host, for example, `ssh -t` gives a program a terminal there, and it can type yes for itself.
- The real boundary is access to the Warden host. Whoever can run commands there as the daemon's user, or as root, which can become that user, can approve a plan.
- So the agent's machine must have no operator access to the Warden host. The safety topic lists what it must not hold.
