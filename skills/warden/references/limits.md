# Limits

The rate limits and size budgets on agent calls and plans, and what an agent does when it reaches one.

## Applies per hour

- A credential may make 30 apply calls an hour unless the operator set another limit for it. The hour is a sliding window: the last 60 minutes.
- Every call to `apply_confirmed` or `submit` that reaches the tool counts one, whether Warden carries it out or refuses it for its arguments, a plan limit or a change of the credential's level. A loop of refused calls reaches the limit too. A tool outside the credential's level is refused with -32602 and does not count. An `apply_confirmed` refused because the plan needs the operator does not count either.
- These do not count: a resend with the same `request_id` after a lost reply, which gives the first answer back; the operator's approval; `plan`, `plan_restore`, `plan_status` and the read tools; and the operations inside one plan.
- Over the limit, the call is refused with the code `rate_limited`. The text gives the time the next call is free, and calls before then are refused. A call refused for a full hour is not counted, so that time stays true.
- The count lives in the daemon's memory. A reload keeps it while the credential stays in the config, and a reload that removes the credential drops it. A restart of Warden resets every count to zero. The agent cannot restart Warden.

### Setting the limit

The limit is the `applies_per_hour` key of the credential's own entry in the `[api]` section of the config, next to its `name` and `level`: a whole number from 1 to 600. No `warden` command or flag sets it. The operator edits the config, then reloads.

Commands for the operator, on the Warden host:

```
warden config edit
warden reload
warden credential list
```

- A value outside 1 to 600 disables that credential: Warden skips the entry with a warning, as for any bad entry. `warden credential list` shows the warning.
- Without the key, the limit is 30.

## Flush and refresh

- An Automatic credential may flush the cache once a minute with `flush_cache_confirmed` and refresh the lists once a minute with `refresh_lists_confirmed`. Each kind has its own minute.
- Over it, the call is refused with `rate_limited` and the time the next call of that kind is free.
- A call refused for its arguments or its credential takes no minute.
- Flushes and refreshes do not count against the hourly apply limit.

### When a flush helps

- A change of lists, rules or profiles needs no flush. Warden decides block and allow before it reads its cache. For an answer from the cache, it checks the CNAME chain and the answer addresses again against the client's profile on every query.
- A device can still use an answer it got before the change, until that answer's TTL ends. For a blocked answer that is the profile's blocked-answer TTL. Ask the person to reconnect the device to the network, or to flush the DNS cache of the device or its browser.
- Flush Warden's cache only for a stale upstream answer.

## Waiting for an apply

- An apply that changes which lists a profile uses rebuilds the lists. On a large list set that can take minutes. Other applies take seconds.
- While the activation is not final, `apply_confirmed` and `plan_status` give `retry_after_seconds`. Call `plan_status` again after that many seconds, never in a loop. A final answer has no `retry_after_seconds`: stop asking.
- A receipt with the persistence `durability_uncertain` means Warden is not sure the change was saved. Send `apply_confirmed` again with the same arguments, the same `request_id` included. Warden reads the saved receipt and gives it back, and that call does not count. If Warden finds no saved receipt, it refuses the call: tell the operator.

## Plan budgets

- One plan holds at most 256 operations. A plan whose operations do not fit one answer in short form is refused too, so long names lower that number. Split the change into smaller plans.
- A credential holds at most 8 plans it has not applied. A submitted plan no longer counts here.
- A credential holds at most 5 plans waiting for the operator's approval. A sixth is refused; it never replaces an older one.
- The daemon holds at most 32 open agent plans, over all credentials. Over it, Warden refuses the call and says to try again later.
- Two clocks apply. A plan lives 15 minutes after it was made, for its apply or its submit. A submitted plan then waits up to 24 hours for the operator.

## At a limit

- Stop. Do not retry in a loop: a refused apply or submit counts too.
- Tell the operator which limit you reached and when the next call is free, as the error says.
- To learn what became of a change you already sent, read `plan_status`. It never counts against the limit. Do not send the change again.
- At a plan budget, apply or submit a plan you hold, or wait until one expires. At the pending limit, ask the operator to approve or reject a plan.

## What the operator sees

- Limit hits, applies by an Automatic credential, submissions, expiries and rejections show as notices. `warden agent pending` lists them after the waiting plans, newest first, each with the time and the credential name.
- A credential that stays at its limit raises one notice an hour for that limit, not one per refused call.
- The daemon keeps the newest 64 notices, in memory, so a restart clears them.
