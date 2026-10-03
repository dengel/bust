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
| `YES` / `NO` | Opt in or decline. Until a person replies YES, any text gets the welcome prompt and nothing is logged for them or sent to them |

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

1. **Twilio:** create an account and buy a **local** number. Then register it for A2P 10DLC as a **Sole Proprietor**, which works without an EIN: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/direct-sole-proprietor-registration-overview
   US carriers block unregistered traffic, so allow days to weeks for approval. Registration has one-time brand and campaign fees; check the current amounts in the Twilio console. A toll-free number with toll-free verification also works, but I couldn't confirm that individuals without an EIN qualify for it.
2. **Cloudflare:**
   ```sh
   npx wrangler login
   npx wrangler d1 create bust             # paste the database_id into wrangler.jsonc
   npx wrangler d1 execute bust --remote --file schema.sql
   for s in PERSON_A_NAME PERSON_A_PHONE PERSON_B_NAME PERSON_B_PHONE \
            TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_NUMBER; do npx wrangler secret put $s; done
   npm run deploy
   ```
   Phone numbers must be in E.164 format (`+15551234567`).
3. **Webhook:** in the Twilio console, go to Phone Numbers, select your number, and under Messaging set "A message comes in" to the deployed `https://bust.<subdomain>.workers.dev/` URL, method `POST`. If signature checks fail (403s in `npx wrangler tail`), set a `WEBHOOK_URL` secret to the exact URL configured in Twilio.

## Compliance pages

Twilio's 10DLC campaign review needs public SMS terms and a privacy policy. They live in `docs/` and are served by GitHub Pages:

- SMS terms and opt-in: https://dengel.github.io/bust/
- Privacy policy: https://dengel.github.io/bust/privacy.html

Keep the sample messages there in sync with `src/logic.js` and with the samples in the Twilio campaign form. The registered brand is **Buster**. Twilio answers YES/START, STOP and HELP itself (and still forwards them to the Worker, which records consent and sends no reply of its own). In the Messaging Service's Opt-Out Management, set those three replies to the exact texts quoted on the terms page, since reviewers text them to test.

## Cost (Twilio US list prices, checked 2026-10-02)

- Local number: $1.15/month (toll-free: $2.15/month), plus one-time 10DLC registration fees
- SMS: $0.0083 per segment in or out, plus carrier fees on outbound of about $0.0035–0.005
- Cloudflare Workers + D1: free tier

About 60 entries a month (one inbound plus one reply each) comes to roughly **$2.50–3/month**. Replies use no emoji (emoji switch the message to an encoding that allows only 70 characters per segment). Most replies are one segment; ones with long notes, BUST alerts, and HISTORY can be 2–3.
