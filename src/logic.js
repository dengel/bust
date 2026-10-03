// Pure logic: parsing, money formatting, reply text. No I/O, so it is unit-tested directly.

const AMOUNT_RE = /^\$?(\d{1,6}(?:\.\d{1,2})?|\.\d{1,2})(?=\s|$)\s*(.*)$/s;
const NOTE_MAX = 80;

// Avoid STOP/START/HELP/UNSUBSCRIBE etc.: carriers and Twilio intercept those.
const COMMANDS = {
  balance: "balance", bal: "balance",
  undo: "undo",
  history: "history", hist: "history",
  paid: "paid",
  commands: "usage", "?": "usage",
};

export const USAGE = "Text an amount you paid, e.g. \"42.50 dinner\". Commands: BALANCE, UNDO, HISTORY, PAID.";

// Twilio's default keyword lists. Twilio sends its own replies to these (configured under the
// Messaging Service's Opt-Out Management) and passes OptOutType = STOP | START | HELP to the webhook.
const OPT_KEYWORDS = {
  STOP: ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "revoke"],
  START: ["start", "yes", "unstop"],
  HELP: ["help", "info"],
};

// Returns "yes" | "no" | "stop" | "help" | null. NO isn't a Twilio keyword, so the bot replies to it itself.
export function consentKeyword(body, optOutType) {
  const text = (body || "").trim().toLowerCase();
  const type = optOutType || Object.keys(OPT_KEYWORDS).find((k) => OPT_KEYWORDS[k].includes(text));
  if (type === "START") return "yes";
  if (type === "STOP") return "stop";
  if (type === "HELP") return "help";
  return text === "no" ? "no" : null;
}

export function consentPrompt(otherName) {
  return `Buster: Reply YES to get shared expense tally texts with ${otherName}. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;
}

export const DECLINED = "Buster: OK, you won't get Buster texts. Reply YES anytime to join.";

export function parseMessage(body) {
  const text = (body || "").trim();
  const cmd = COMMANDS[text.toLowerCase()];
  if (cmd) return { type: cmd };

  const m = text.match(AMOUNT_RE);
  if (!m) return { type: "usage" };
  const cents = toCents(m[1]);
  if (cents <= 0) return { type: "usage" };
  const note = m[2].replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return { type: "entry", cents, note };
}

function toCents(s) {
  const [whole, frac = ""] = s.split(".");
  return Number(whole || "0") * 100 + Number(frac.padEnd(2, "0"));
}

export function money(cents) {
  return "$" + (Math.abs(cents) / 100).toFixed(2);
}

// people = { a: {name, phone}, b: {name, phone} }. Positive balance means b owes a.
export function describeBalance(balance, people) {
  if (balance === 0) return "You're even.";
  const [debtor, creditor] = balance > 0 ? [people.b, people.a] : [people.a, people.b];
  return `${debtor.name} owes ${creditor.name} ${money(balance)}.`;
}

export function isBust(balance, thresholdCents) {
  return Math.abs(balance) >= thresholdCents;
}

// True when this change should trigger a BUST alert: newly over the line, or the debtor flipped.
export function becameBust(before, after, thresholdCents) {
  return isBust(after, thresholdCents) && (!isBust(before, thresholdCents) || Math.sign(before) !== Math.sign(after));
}

export function logged({ cents, note }) {
  return `Logged ${note ? `${money(cents)} (${note})` : money(cents)}.`;
}

export function entryReply(entry, balance, people) {
  return `${logged(entry)} ${describeBalance(balance, people)}`;
}

export function bustMessage(balance, people) {
  return `BUST! ${describeBalance(balance, people)} Send it, then text PAID to reset.`;
}

export function stillBustSuffix() {
  return " Still busted: settle up and text PAID.";
}

export function paidMessage(balance, people) {
  const [debtor, creditor] = balance > 0 ? [people.b, people.a] : [people.a, people.b];
  return `Settled: ${debtor.name} paid ${creditor.name} ${money(balance)}. Tally reset to $0.`;
}

export function undoReply(entry) {
  return `Undid ${entry.note ? `${money(entry.amount_cents)} (${entry.note})` : money(entry.amount_cents)}.`;
}

export function historyReply(rows, people) {
  if (rows.length === 0) return "No entries since the last reset.";
  const byPhone = { [people.a.phone]: people.a.name, [people.b.phone]: people.b.name };
  return rows
    .map((r) => {
      const who = byPhone[r.sender] || "?";
      return `${who} ${money(r.amount_cents)}${r.note ? " " + r.note : ""}`;
    })
    .join("\n");
}

export function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);
}

export function twiml(message) {
  const body = message ? `<Message>${escapeXml(message)}</Message>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}
