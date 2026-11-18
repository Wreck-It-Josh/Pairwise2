// Live exchange rates for the Wallet tab, served at /api/rates.
// Source: ExchangeRate-API's free open endpoint (no key; updates once a day; attribution required,
// which the Wallet shows). The answer is cached here and at Netlify's CDN so the source is asked
// at most about once an hour.

const SOURCE = "https://open.er-api.com/v6/latest/USD";
const HOUR = 3600 * 1000;
let cache = null; // { body, at }

async function fetchRates() {
  const r = await fetch(SOURCE, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("source " + r.status);
  const d = await r.json();
  const pick = (k) => {
    const v = Number(d && d.rates && d.rates[k]);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const body = {
    base: "USD",
    GYD: pick("GYD"), // G$ per US$1
    EUR: pick("EUR"), // € per US$1
    GBP: pick("GBP"), // £ per US$1
    updated: Number(d && d.time_last_update_unix) || Math.floor(Date.now() / 1000),
    source: "ExchangeRate-API",
  };
  if (d.result !== "success" || !body.GYD || !body.EUR || !body.GBP) throw new Error("bad data");
  return body;
}

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  try {
    if (!cache || Date.now() - cache.at > HOUR) cache = { body: await fetchRates(), at: Date.now() };
  } catch (e) {
    if (!cache) {
      return Response.json({ error: "unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    // the source is down: keep serving the last good rates
  }
  return Response.json(cache.body, {
    headers: {
      "Cache-Control": "public, max-age=600",
      "Netlify-CDN-Cache-Control": "public, durable, max-age=3600, stale-while-revalidate=86400",
    },
  });
};

export const config = { path: "/api/rates" };
