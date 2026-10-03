// Simulate a signed Twilio webhook against `wrangler dev`.
// Usage: node scripts/text.mjs <a|b> "<message>" [url]
import { computeSignature } from "../src/twilio.js";
import { readFileSync } from "node:fs";

const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const [who, body, url = "http://localhost:8787/"] = process.argv.slice(2);
const params = {
  MessageSid: "SM" + crypto.randomUUID().replace(/-/g, ""),
  From: who === "b" ? vars.PERSON_B_PHONE : who === "a" ? vars.PERSON_A_PHONE : who,
  To: vars.TWILIO_NUMBER,
  Body: body,
};
const res = await fetch(url, {
  method: "POST",
  headers: { "X-Twilio-Signature": await computeSignature(vars.TWILIO_AUTH_TOKEN, url, params) },
  body: new URLSearchParams(params),
});
console.log(res.status, await res.text());
