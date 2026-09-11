// TradeOptix — Access Requests List — ADMIN only (JWT verify local).
const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";
const JWT_PUB = Deno.env.get("JWT_PUBLIC_KEY") ?? "";
const ADMIN = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function b64u(x) { return Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)); }

async function runSql(sql) {
  const r = await fetch(`${BASE}/api/database/advance/rawsql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`SQL API ${r.status}`);
  const raw = await r.json();
  return raw.rows ?? raw.data ?? [];
}

async function verifyJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64u(parts[1])));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    if (JWT_PUB) {
      try {
        const der = b64u(JWT_PUB.replace(/-----[^-]+-----|\s+/g, ""));
        const key = await crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
        const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
        if (!ok) return null;
      } catch (e) {}
    }
    return payload;
  } catch (e) { return null; }
}

export default async function handler(req) {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const payload = await verifyJwt(token);
    const email = String((payload && (payload.email || payload.user_email)) || "").toLowerCase();
    if (!email || !ADMIN.includes(email)) return new Response(JSON.stringify({ error: "admin only" }), { status: 403, headers: cors });
    const rows = await runSql(`SELECT email,status,requested_at,approved_at FROM access_requests ORDER BY requested_at DESC LIMIT 50`);
    return new Response(JSON.stringify({ requests: rows }, null, 1), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
