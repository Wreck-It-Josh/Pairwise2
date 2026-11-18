// Lock-screen notifications for shared lists, served at /api/notify.
//
// GET  -> { push: true|false, key: "<VAPID public key>" }  (whether notifications are set up, and the
//         public key a phone needs to subscribe)
// POST -> sends one notification to the signed-in person's partner. Body: { text, tag }.
//
// Needs these Netlify environment variables:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   the key pair that signs notifications (private key: server only)
//   SUPABASE_URL, SUPABASE_ANON_KEY       to check who is sending and look up the partner's phones
//   VAPID_SUBJECT (optional)              contact for the push services; defaults to the site address
//
// The sender's own Supabase session does the lookup, through partner_push_subs() in supabase/push.sql,
// so this function never needs a secret Supabase key and can only reach the sender's own partner.
//
// Web push is done with Node's built-in crypto (no packages): the request is signed with the VAPID key
// (RFC 8292) and the message is encrypted for the receiving phone (RFC 8291, "aes128gcm").

import crypto from "node:crypto";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(String(s), "base64url");

// VAPID: a short-lived ES256 token proving the message comes from this site's key pair.
function vapidHeader(endpoint, subject, publicKey, privateKey) {
  const pub = unb64u(publicKey); // 65 bytes: 0x04 || x || y
  const key = crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(
    JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })
  );
  const sig = crypto.sign("sha256", Buffer.from(head + "." + claims), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

// RFC 8291: only the receiving phone (holder of p256dh's private key and the auth secret) can read it.
function encrypt(payload, p256dh, authSecret) {
  const uaPublic = unb64u(p256dh),
    auth = unb64u(authSecret);
  const ecdh = crypto.createECDH("prime256v1");
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
  const prkKey = hmac(auth, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

async function sendPush(sub, payload, { subject, publicKey, privateKey, ttl, topic }) {
  const headers = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(ttl),
    Urgency: "normal",
    Authorization: vapidHeader(sub.endpoint, subject, publicKey, privateKey),
  };
  if (topic) headers.Topic = topic;
  const r = await fetch(sub.endpoint, { method: "POST", headers, body: encrypt(payload, sub.p256dh, sub.auth) });
  if (!r.ok) {
    const e = new Error("push " + r.status);
    e.statusCode = r.status;
    throw e;
  }
}

const HOURLY_LIMIT = Number(process.env.NOTIFY_HOURLY_LIMIT) || 60;
const hits = new Map(); // user id -> timestamps of recent sends (per running instance)

const env = (k) => (process.env[k] || "").trim();
const configured = () =>
  !!(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY") && env("SUPABASE_URL") && env("SUPABASE_ANON_KEY"));
const sbUrl = () => env("SUPABASE_URL").replace(/\/+$/, "");

async function signedInUser(auth) {
  try {
    const r = await fetch(sbUrl() + "/auth/v1/user", {
      headers: { apikey: env("SUPABASE_ANON_KEY"), authorization: auth },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch {
    return null;
  }
}

// Calls a database function as the signed-in sender.
async function rpc(auth, name, args) {
  const r = await fetch(sbUrl() + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: env("SUPABASE_ANON_KEY"), authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(args || {}),
  });
  if (!r.ok) throw new Error(name + " " + r.status);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

function limited(uid) {
  const now = Date.now(),
    recent = (hits.get(uid) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= HOURLY_LIMIT) return true;
  recent.push(now);
  hits.set(uid, recent);
  return false;
}

// Plain text only, one line, short.
const clean = (s, max) =>
  String(s || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export default async (req) => {
  const json = (body, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

  if (req.method === "GET") return json({ push: configured(), key: configured() ? env("VAPID_PUBLIC_KEY") : null });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!configured()) return json({ error: "not_configured" }, 503);

  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer \S+$/.test(auth)) return json({ error: "signed_out" }, 401);
  const user = await signedInUser(auth);
  if (!user) return json({ error: "signed_out" }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const text = clean(body && body.text, 180);
  const tag = clean(body && body.tag, 64) || "pairwise";
  if (!text) return json({ error: "bad_request" }, 400);
  if (limited(user.id)) return json({ error: "rate_limited" }, 429);

  let subs;
  try {
    subs = (await rpc(auth, "partner_push_subs")) || [];
  } catch {
    return json({ error: "lookup_failed" }, 502);
  }
  if (!subs.length) return json({ sent: 0 });

  const opts = {
    subject: env("VAPID_SUBJECT") || env("URL") || "https://pairwise2.netlify.app",
    publicKey: env("VAPID_PUBLIC_KEY"),
    privateKey: env("VAPID_PRIVATE_KEY"),
    ttl: 6 * 3600,
    topic: tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32),
  };
  const payload = JSON.stringify({ title: "Pairwise", body: text, tag, url: "/#checklist" });

  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        if (!/^https:\/\//.test(s.endpoint)) return;
        await sendPush(s, payload, opts);
        sent++;
      } catch (e) {
        // 404/410: that phone no longer accepts notifications (reset, uninstalled, permission off)
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          try {
            await rpc(auth, "drop_partner_push_sub", { p_endpoint: s.endpoint });
          } catch {}
        }
      }
    })
  );
  return json({ sent });
};

export const config = { path: "/api/notify" };
