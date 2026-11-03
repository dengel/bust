# TODO

Ideas to review. Nothing here is committed to.

## Pending from earlier work

- [ ] Update the Twilio campaign form for the entry/UNDO notices to the other person, then merge the `terms-notices` branch and push (this publishes the terms page).
- [ ] Person B: STOP then START, and confirm the START reply arrives.
- [ ] First-time START got no reply for Person B (2026-10-05). Only reproducible with a number that has never texted Buster.

## Features

Ranked by usefulness for the effort.

1. [ ] **Partial payments: `PAID 40`.** Record a payment of any amount at any time and reduce the balance. Plain `PAID` stays as is (only when busted, clears the full balance). Notify the other person.
2. [ ] **Unpaid BUST reminder.** If no `PAID` within N days of a BUST, text both people once. Needs a Cloudflare cron trigger (free). First message Buster sends without anyone texting first: add it to the terms page and campaign.
3. [ ] **Split entries: `SPLIT 84 dinner`.** Logs half the amount. Only worth it if you often pay for shared things.
4. [ ] **`LIMIT 150`.** Change the BUST threshold by text. Today it's the `BUST_THRESHOLD_DOLLARS` var.
5. [ ] **`QUIET` / `LOUD`.** Per-person mute for entry notices. BUST and settled texts still go out.
6. [ ] **`MONTH` summary.** Totals this month by person, optionally by note.
7. [ ] **Edit the last note: `NOTE groceries`.** Fix a typo'd note without UNDO + re-entry.

## Reliability

- [ ] **Alert on failed notices.** `sendSms` only logs failures (`src/twilio.js`), so a missed notice to the other person goes unnoticed. Option: reply to the sender "Couldn't notify Sam", or check Twilio's error log weekly.
- [ ] **D1 backup.** Periodic `wrangler d1 export` of the ledger, or a cron that emails a CSV.
- [ ] **Prune `processed`.** The MessageSid dedupe table grows forever. Rows older than 30 days can go. Tiny, low priority.
