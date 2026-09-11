// TradeOptix — Access Requests List — InsForge Edge Function (Deno/TS)
// ADMIN only — token verify via InsForge /api/auth/sessions/current.
const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";
const ANON = Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? "";
const ADMIN = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

async function runSql(sql: string): Promise<any[]> {
  const r = await fetch(`${BASE}/api/database/advance/rawsql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`SQL API ${r.status}`);
  const raw = await r.json();
  return raw.rows ?? raw.data ?? [];
}

async function getUserByToken(token: string): Promise<any | null> {
  if (!token || !ANON) return null;
  try {
    const r = await fetch(`${BASE}/api/auth/sessions/current`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.user || (d.data && d.data.user) || (d.email ? d : null);
  } catch { return null; }
}

export default async function handler(req: Request): Promise<Response> {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const user = await getUserByToken(token);
    const email = String((user && user.email) || "").toLowerCase();
    if (!email || !ADMIN.includes(email)) return new Response(JSON.stringify({ error: "admin only" }), { status: 403, headers: cors });
    const rows = await runSql(`SELECT email,status,requested_at,approved_at FROM access_requests ORDER BY requested_at DESC LIMIT 50`);
    return new Response(JSON.stringify({ requests: rows }, null, 1), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
