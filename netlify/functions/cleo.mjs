// Cleo: the Pairwise money assistant, served as a Netlify Function at /api/cleo.
//
// The browser never sees the Anthropic API key. Each request must carry the person's Supabase
// access token; the function checks it with Supabase before calling Claude, so only signed-in
// Pairwise users can use it. The reply streams back as newline-delimited JSON:
//   {"t":"text chunk"} ... then {"done":true,"stop":"end_turn"} or {"error":"code"}
//
// Netlify environment variables (Site configuration > Environment variables):
//   ANTHROPIC_API_KEY   from console.anthropic.com
//   SUPABASE_URL        same value as supabaseUrl in public/config.js
//   SUPABASE_ANON_KEY   same value as supabaseAnonKey in public/config.js
//   CLEO_HOURLY_LIMIT   optional, questions per person per hour (default 30)

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";
const MAX_MESSAGES = 24;
const MAX_CHARS = 80000;
const HOURLY_LIMIT = Number(process.env.CLEO_HOURLY_LIMIT) || 30;

// The app sends Cleo's full style rules and the household's numbers in the first message.
// This system prompt only pins the role, so the endpoint is not a general-purpose chatbot.
const SYSTEM =
  "You are Cleo, the money assistant inside Pairwise, a household budgeting app. " +
  "Follow the app's instructions in the first message and answer from the data it provides. " +
  "Help only with the household's money, budgeting, saving, shopping plans and how to use the app; " +
  "for anything unrelated, say briefly that you can only help with their money and the app.";

// Best-effort rate limit. It lives in memory, so it resets when Netlify starts a fresh instance;
// set a monthly spend limit in the Anthropic Console as the real cap.
const hits = new Map();
function allow(userId) {
  const now = Date.now();
  const recent = (hits.get(userId) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= HOURLY_LIMIT) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  return true;
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function configured() {
  return !!(process.env.ANTHROPIC_API_KEY && process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

// Ask Supabase who this token belongs to. Returns the user, or null if the token is missing or invalid.
async function signedInUser(req) {
  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer \S+$/.test(auth)) return null;
  try {
    const r = await fetch(process.env.SUPABASE_URL.replace(/\/+$/, "") + "/auth/v1/user", {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, authorization: auth },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch {
    return null;
  }
}

// Accept only plain-text user/assistant turns, starting with the user, within size limits.
function cleanMessages(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_MESSAGES) return null;
  let total = 0;
  const out = [];
  for (const m of list) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return null;
    const content = m.content.trim();
    if (!content) continue;
    total += content.length;
    if (total > MAX_CHARS) return null;
    out.push({ role: m.role, content });
  }
  if (!out.length || out[0].role !== "user") return null;
  return out;
}

export default async (req) => {
  // The app calls GET once to learn whether AI answers are switched on.
  if (req.method === "GET") return json(200, { ai: configured() });
  if (req.method !== "POST") return json(405, { code: "method_not_allowed" });
  if (!configured()) return json(503, { code: "not_declared" });

  const user = await signedInUser(req);
  if (!user) return json(401, { code: "session_expired" });
  if (!allow(user.id)) return json(429, { code: "rate_limited" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { code: "bad_request" });
  }
  const messages = cleanMessages(body && body.messages);
  if (!messages) return json(400, { code: "bad_request" });

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const enc = new TextEncoder();

  const body$ = new ReadableStream({
    async start(controller) {
      const send = (o) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          // the browser already went away
        }
      };
      try {
        const stream = client.beta.messages.stream(
          {
            model: MODEL,
            max_tokens: 8000,
            output_config: { effort: "low" }, // short chat answers; raise to "medium" for deeper plans
            // If Claude declines on a safety classifier, the API retries on a suitable model automatically.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: SYSTEM,
            messages,
            metadata: { user_id: user.id },
          },
          { signal: req.signal },
        );
        stream.on("text", (delta) => send({ t: delta }));
        const msg = await stream.finalMessage();
        send({ done: true, stop: msg.stop_reason });
      } catch (e) {
        if (e instanceof Anthropic.APIUserAbortError || req.signal.aborted) {
          send({ error: "cancelled" });
        } else if (e instanceof Anthropic.RateLimitError) {
          send({ error: "rate_limited" });
        } else if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
          console.error("Cleo: the Anthropic API key was rejected. Check ANTHROPIC_API_KEY.", e.status);
          send({ error: "error" });
        } else if (e instanceof Anthropic.APIError) {
          console.error("Cleo: Claude API error", e.status, e.message);
          send({ error: "error" });
        } else {
          console.error("Cleo: unexpected error", e);
          send({ error: "error" });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(body$, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
};

export const config = { path: "/api/cleo" };
