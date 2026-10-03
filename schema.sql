-- Append-only ledger. Balance = SUM(amount_cents) of non-voided rows.
-- Positive amounts: person A paid (B owes A). Negative: person B paid.
-- kind 'settle' rows zero the balance when someone texts PAID.
CREATE TABLE IF NOT EXISTS entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  sender       TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('entry', 'settle')),
  amount_cents INTEGER NOT NULL,
  note         TEXT,
  voided       INTEGER NOT NULL DEFAULT 0
);

-- Twilio can redeliver a webhook; this makes each MessageSid process once (matters for UNDO).
CREATE TABLE IF NOT EXISTS processed (
  message_sid TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Opt-in state per participant. Nothing is logged for, or sent to, a number until it replies YES.
-- 'no' is set by NO or STOP; YES/START re-enrolls.
CREATE TABLE IF NOT EXISTS consent (
  phone      TEXT PRIMARY KEY,
  status     TEXT NOT NULL CHECK (status IN ('yes', 'no')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
