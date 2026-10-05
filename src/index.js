import {
  parseMessage, isBust, becameBust, logged, entryReply, bustMessage, stillBustSuffix, paidMessage,
  undoReply, historyReply, describeBalance, twiml, USAGE, consentKeyword, consentPrompt, KEYWORD_REPLIES,
} from "./logic.js";
import { isValidSignature, sendSms } from "./twilio.js";

const xml = (message) => new Response(twiml(message), { headers: { "Content-Type": "text/xml" } });

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Not found", { status: 404 });

    const params = Object.fromEntries(await request.formData());
    const url = env.WEBHOOK_URL || request.url;
    const ok = await isValidSignature(env.TWILIO_AUTH_TOKEN, url, params, request.headers.get("X-Twilio-Signature"));
    if (!ok) return new Response("Forbidden", { status: 403 });

    const people = {
      a: { name: env.PERSON_A_NAME, phone: env.PERSON_A_PHONE },
      b: { name: env.PERSON_B_NAME, phone: env.PERSON_B_PHONE },
    };
    const sender = params.From === people.a.phone ? people.a : params.From === people.b.phone ? people.b : null;
    if (!sender) return xml(null); // Unknown number: silent, no reply cost.
    const other = sender === people.a ? people.b : people.a;

    const fresh = await env.DB.prepare("INSERT OR IGNORE INTO processed (message_sid) VALUES (?)")
      .bind(params.MessageSid).run();
    if (fresh.meta.changes === 0) return xml(null); // Twilio redelivery.

    // Consent gate. When Twilio handles a keyword (Advanced Opt-Out) it sets OptOutType and sends its own
    // reply, so we stay silent; otherwise we send the registered reply ourselves.
    const keyword = consentKeyword(params.Body, params.OptOutType);
    if (keyword) {
      console.log(`keyword=${keyword} OptOutType=${params.OptOutType ?? "(none)"}`);
      if (keyword !== "help") await setConsent(env.DB, sender.phone, keyword === "yes" ? "yes" : "no");
      return xml(params.OptOutType ? null : KEYWORD_REPLIES[keyword]);
    }
    if ((await getConsent(env.DB, sender.phone)) !== "yes") return xml(consentPrompt(other.name));

    const threshold = Number(env.BUST_THRESHOLD_DOLLARS || 100) * 100;
    const otherOptedIn = (await getConsent(env.DB, other.phone)) === "yes";
    const notifyOther = (text) => otherOptedIn && ctx.waitUntil(sendSms(env, other.phone, text));
    const msg = parseMessage(params.Body);

    switch (msg.type) {
      case "entry": {
        const signed = sender === people.a ? msg.cents : -msg.cents;
        await env.DB.prepare("INSERT INTO entries (sender, kind, amount_cents, note) VALUES (?, 'entry', ?, ?)")
          .bind(sender.phone, signed, msg.note || null).run();
        const balance = await getBalance(env.DB);
        if (becameBust(balance - signed, balance, threshold)) {
          const bust = bustMessage(balance, people);
          notifyOther(bust);
          return xml(`${logged(msg)} ${bust}`);
        }
        return xml(entryReply(msg, balance, people) + (isBust(balance, threshold) ? stillBustSuffix() : ""));
      }

      case "undo": {
        const last = await env.DB.prepare(
          `SELECT * FROM entries WHERE sender = ? AND kind = 'entry' AND voided = 0 AND id > ?
           ORDER BY id DESC LIMIT 1`,
        ).bind(sender.phone, await lastSettleId(env.DB)).first();
        if (!last) return xml("Nothing of yours to undo since the last reset.");
        await env.DB.prepare("UPDATE entries SET voided = 1 WHERE id = ?").bind(last.id).run();
        const balance = await getBalance(env.DB);
        if (becameBust(balance + last.amount_cents, balance, threshold)) {
          const bust = bustMessage(balance, people);
          notifyOther(bust);
          return xml(`${undoReply(last)} ${bust}`);
        }
        return xml(`${undoReply(last)} ${describeBalance(balance, people)}` + (isBust(balance, threshold) ? stillBustSuffix() : ""));
      }

      case "paid": {
        const balance = await getBalance(env.DB);
        // Reset only happens after a bust; a stray PAID can't wipe a running tally.
        if (!isBust(balance, threshold)) return xml(`Not busted yet. ${describeBalance(balance, people)}`);
        await env.DB.prepare("INSERT INTO entries (sender, kind, amount_cents) VALUES (?, 'settle', ?)")
          .bind(sender.phone, -balance).run();
        const text = paidMessage(balance, people);
        notifyOther(text);
        return xml(text);
      }

      case "history": {
        const { results } = await env.DB.prepare(
          `SELECT sender, amount_cents, note FROM entries
           WHERE kind = 'entry' AND voided = 0 AND id > ? ORDER BY id DESC LIMIT 10`,
        ).bind(await lastSettleId(env.DB)).all();
        const balance = await getBalance(env.DB);
        return xml(`${historyReply(results.reverse(), people)}\n${describeBalance(balance, people)}`);
      }

      case "balance": {
        const balance = await getBalance(env.DB);
        return xml(describeBalance(balance, people) + (isBust(balance, threshold) ? stillBustSuffix() : ""));
      }

      default:
        return xml(USAGE);
    }
  },
};

async function getConsent(db, phone) {
  const row = await db.prepare("SELECT status FROM consent WHERE phone = ?").bind(phone).first();
  return row?.status ?? null;
}

async function setConsent(db, phone, status) {
  await db.prepare(
    `INSERT INTO consent (phone, status) VALUES (?, ?)
     ON CONFLICT (phone) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`,
  ).bind(phone, status).run();
}

async function getBalance(db) {
  const row = await db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS b FROM entries WHERE voided = 0").first();
  return row.b;
}

async function lastSettleId(db) {
  const row = await db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM entries WHERE kind = 'settle'").first();
  return row.id;
}
