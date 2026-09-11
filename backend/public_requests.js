// TradeOptix — Access Requests List (ADMIN only) — InsForge Edge Function (Deno/TS)
// Admin ke panel me pending requests dikhane ke liye.

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

export default async function handler(req: Request): Promise<Response> {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token || !ANON) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors });
    const ur = await fetch(`${BASE}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    if (!ur.ok) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors });
    const u = await ur.json();
    if (!ADMIN.includes(String(u.email || "").toLowerCase())) {
      return new Response(JSON.stringify({ error: "admin only" }), { status: 403, headers: cors });
    }
    const rows = await runSql(`SELECT email,status,requested_at,approved_at FROM access_requests ORDER BY requested_at DESC LIMIT 50`);
    return new Response(JSON.stringify({ requests: rows }, null, 1), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
