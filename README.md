# bust

A shared SMS tally for two people. Text the number with what you paid, and the bot tracks who owes whom. When either side reaches $100 owed, both of you get a BUST text. The person who owes pays the whole balance, then someone texts `PAID` to reset the tally.

## Texting it

| Text | Effect |
|---|---|
| `42.50 dinner` | Log $42.50 you paid, with an optional note |
| `BALANCE` / `BAL` | Show who owes whom |
| `UNDO` | Void your own most recent entry (since the last reset) |
| `HISTORY` | Last 10 entries since the last reset |
| `PAID` | Only once busted: record that the balance was paid and reset to $0 |
| `START` / `YES` | Opt in. Until a person opts in, any other text gets a welcome prompt and nothing is logged for them or sent to them |
| `NO` | Decline the welcome prompt |
| `STOP` / `HELP` | Opt out / get help (answered by Twilio, see [Opt-out replies](#4-opt-out-replies-advanced-opt-out)) |

- Person A's entries push the balance toward "B owes A". Person B's push the other way.
- When the balance crosses the threshold (from a new entry or an UNDO), both people get the BUST text. They get it again if the debtor flips. Entries are still accepted while busted, and `PAID` settles whatever the balance is at that point. Either person can send `PAID`. It can't be undone.
- Only messages from the two configured numbers with a valid Twilio signature are processed. Anything else is ignored.

## Stack

Cloudflare Worker (`src/index.js`) + D1 (SQLite, `schema.sql`) + Twilio. The ledger is append-only, and undo marks a row as voided rather than deleting it.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars          # DRY_RUN=1 logs outbound SMS instead of sending
npx wrangler d1 execute bust --local --file schema.sql
npm run dev                             # in one terminal
node scripts/text.mjs a "42.50 dinner"  # in another: simulates a signed Twilio webhook
node scripts/text.mjs b "PAID"
npm test
```

## Deploying

### 1. Cloudflare

```sh
npx wrangler login
npx wrangler d1 create bust             # paste the database_id into wrangler.jsonc
npx wrangler d1 execute bust --remote --file schema.sql   # safe to re-run after schema changes
for s in PERSON_A_NAME PERSON_A_PHONE PERSON_B_NAME PERSON_B_PHONE \
         TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_NUMBER; do npx wrangler secret put $s; done
npm run deploy
```

- Phone numbers must be in E.164 format (`+15551234567`). The SID and auth token are on the Twilio console home page.
- The first deploy asks you to register a workers.dev subdomain. The Worker URL is then `https://bust.<subdomain>.workers.dev/`.
- Deploys fail with error 10034 until the Cloudflare account's email address is verified.
- A browser GET to the Worker returns 404. That's expected: it only answers Twilio's signed POSTs.

### 2. Twilio number and Messaging Service

1. Buy a US **local** number (Phone Numbers → Buy a number, SMS capable).
2. Create a Messaging Service (Messaging → Services) and add the number to its **Sender Pool**. 10DLC campaigns attach to the service, and the opt-out replies below only apply to numbers in it.
3. In the service's **Integration** tab, set incoming messages to **Send a webhook** with the Worker URL, method `POST`, or to "Defer to sender's webhook" and set the same URL on the number (Phone Numbers → your number → Messaging → "A message comes in").
4. If signature checks fail (403s in `npx wrangler tail`), set a `WEBHOOK_URL` secret to the exact URL configured in Twilio.

### 3. A2P 10DLC registration

US carriers block texts from unregistered local numbers (Twilio error 30034), so nothing outbound works until this is approved. Inbound texts still reach the Worker in the meantime, so you can test with `npx wrangler tail`. Registration has one-time brand and campaign fees; check the current amounts in the Twilio console. Review took a few days per submission.

1. **Brand:** register as a **Sole Proprietor**, which works without an EIN: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/direct-sole-proprietor-registration-overview. This brand is registered as **Buster**; the compliance pages and every message prefix must use that exact name.
2. **Campaign:** attach it to the Messaging Service from step 2. What got it approved, after three rejections:
   - **Terms and privacy URLs:** the [compliance pages](#compliance-pages). Both must be public and name the registered brand.
   - **Message flow:** describe every opt-in path end to end, quote the public call to action ("Text START to (970) 707-0992" plus the disclosures), and quote each auto-reply word for word. Saying the operator enrolls the numbers reads as having no opt-in (rejection 30909); describe the user texting first.
   - **Keyword fields:** fill in all of them. Opt-in `START, YES`; opt-out `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT`; help `HELP, INFO`; with the opt-in, opt-out and help messages copied from the terms page.
   - **Privacy policy:** must say mobile numbers aren't shared with third parties, state the message frequency, and include "Message and data rates may apply".
   - **Campaign description and samples:** transactional expense-tally texts, with the entry, BUST and settled messages as samples. Leave every content checkbox (direct lending, embedded links, phone numbers, age-gated, affiliate marketing) unchecked.
3. If 10DLC keeps getting rejected, a toll-free number with toll-free verification is the fallback ($1/month more). I couldn't confirm that individuals without an EIN qualify for it.

### 4. Opt-out replies (Advanced Opt-Out)

In the Messaging Service, open the **Opt-out** tab (older console: Opt-out management), click **Enable advanced opt-out**, and edit the Standard Opt-Out Keywords. Set the keywords and reply messages exactly as registered:

| Section | Keywords | Reply |
|---|---|---|
| Opt-out | STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT | `Buster: You're unsubscribed and will get no more messages. Reply START to resubscribe.` |
| Opt-in | START, YES, UNSTOP | `Buster: You're opted in. Text an amount you paid, e.g. 42.50 dinner. Msg freq varies. Msg&data rates may apply. Reply HELP for help, STOP to opt out.` |
| Help | HELP, INFO | `Buster: Shared expense tally. Email multisite@gmail.com for help. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.` |

These are also `KEYWORD_REPLIES` in `src/logic.js`. When Twilio handles a keyword it adds `OptOutType` to the webhook and the Worker stays silent; if that field is missing, the Worker sends the same reply itself, so there's never a double reply. Change the wording in all four places at once: Twilio, `src/logic.js`, `docs/index.html`, and the campaign form.

These auto-replies don't send until the campaign is approved: HELP got no outbound message at all before approval.

### 5. Verify

With `npx wrangler tail` running, from each person's phone:

1. `START`: the opted-in reply (the log shows `keyword=yes OptOutType=START`).
2. `10 test`, then `UNDO`: logged, then undone and even.
3. `BALANCE`, `HISTORY`, `HELP`.
4. Optional: `100 test` then `PAID` to check the BUST alert and reset. The other person only gets the BUST and settled texts once they've opted in.

## Cost (Twilio US list prices, checked 2026-10-02)

- Local number: $1.15/month (toll-free: $2.15/month), plus one-time 10DLC registration fees
- SMS: $0.0083 per segment in or out, plus carrier fees on outbound of about $0.0035–0.005
- Cloudflare Workers + D1: free tier

About 60 entries a month (one inbound plus one reply each) comes to roughly **$2.50–3/month**. Replies use no emoji (emoji switch the message to an encoding that allows only 70 characters per segment). Most replies are one segment; ones with long notes, BUST alerts, and HISTORY can be 2–3.
