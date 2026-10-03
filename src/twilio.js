// Twilio webhook signature: base64(HMAC-SHA1(authToken, url + sorted(key+value)...)).
// https://www.twilio.com/docs/usage/webhooks/webhooks-security
export async function computeSignature(authToken, url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function isValidSignature(authToken, url, params, signature) {
  if (!signature) return false;
  const expected = await computeSignature(authToken, url, params);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// Outbound SMS for notifying the person who didn't send the message (TwiML can only reply to the sender).
export async function sendSms(env, to, body) {
  if (env.DRY_RUN === "1") {
    console.log(`[DRY_RUN] SMS to ${to}: ${body}`);
    return;
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: env.TWILIO_NUMBER, Body: body }),
  });
  if (!res.ok) console.error(`Twilio send failed ${res.status}: ${await res.text()}`);
}
