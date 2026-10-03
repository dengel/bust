import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMessage, money, describeBalance, isBust, twiml, bustMessage, historyReply, paidMessage, becameBust } from "../src/logic.js";
import { computeSignature, isValidSignature } from "../src/twilio.js";

const people = { a: { name: "Daniel", phone: "+15550000001" }, b: { name: "Sam", phone: "+15550000002" } };

test("parses amounts and notes", () => {
  assert.deepEqual(parseMessage("42"), { type: "entry", cents: 4200, note: "" });
  assert.deepEqual(parseMessage("$42.5 dinner out"), { type: "entry", cents: 4250, note: "dinner out" });
  assert.deepEqual(parseMessage(" 12.34   gas  station "), { type: "entry", cents: 1234, note: "gas station" });
  assert.deepEqual(parseMessage(".99 gum"), { type: "entry", cents: 99, note: "gum" });
});

test("rejects bad amounts", () => {
  for (const s of ["", "0", "0.00", "-5", "42abc", "42.505", "abc", "1234567"]) {
    assert.equal(parseMessage(s).type, "usage", s);
  }
});

test("commands are case-insensitive", () => {
  assert.equal(parseMessage("PAID").type, "paid");
  assert.equal(parseMessage("Undo").type, "undo");
  assert.equal(parseMessage("bal").type, "balance");
  assert.equal(parseMessage("history").type, "history");
});

test("balance description and bust", () => {
  assert.equal(money(-12345), "$123.45");
  assert.equal(describeBalance(0, people), "You're even.");
  assert.equal(describeBalance(4000, people), "Sam owes Daniel $40.00.");
  assert.equal(describeBalance(-2500, people), "Daniel owes Sam $25.00.");
  assert.ok(isBust(10000, 10000) && isBust(-10000, 10000) && !isBust(9999, 10000));
  assert.equal(paidMessage(-2500, people), "Settled: Daniel paid Sam $25.00. Tally reset to $0.");
  assert.equal(bustMessage(11250, people), "BUST! Sam owes Daniel $112.50. Send it, then text PAID to reset.");
});

test("bust alerts fire on crossing or debtor flip only", () => {
  assert.ok(becameBust(9000, 10500, 10000));
  assert.ok(!becameBust(10500, 11000, 10000));
  assert.ok(becameBust(10500, -10500, 10000));
  assert.ok(!becameBust(10500, 9000, 10000));
});

test("history lists who paid what", () => {
  const rows = [{ sender: "+15550000001", amount_cents: 4200, note: "dinner" }, { sender: "+15550000002", amount_cents: -900, note: null }];
  assert.equal(historyReply(rows, people), "Daniel $42.00 dinner\nSam $9.00");
});

test("twiml escapes notes", () => {
  assert.equal(twiml("food & <drinks>"), '<?xml version="1.0" encoding="UTF-8"?><Response><Message>food &amp; &lt;drinks&gt;</Message></Response>');
  assert.equal(twiml(null), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

test("signature matches Twilio's documented example", async () => {
  // Example values from Twilio's webhook security docs / official helper-library tests.
  const token = "12345";
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  const sig = await computeSignature(token, url, params);
  assert.equal(sig, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  assert.ok(await isValidSignature(token, url, params, sig));
  assert.ok(!(await isValidSignature(token, url, { ...params, Digits: "9" }, sig)));
});
