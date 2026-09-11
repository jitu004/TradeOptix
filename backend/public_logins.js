// TradeOptix — Login Activity API — InsForge Edge Function (Deno/TS)
// Sirf LOGGED-IN users ko login history dikhati hai (JWT verify hota hai).
// Frontend apna access token bhejta hai; invalid token = 401.

const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";
const ANON = Deno.env.get("INSFORGE_ANON_KEY") ?? "";

function esc(v: string): string { return v.replace(/'/g, "''"); }

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

async function verifyUser(req: Request): Promise<any | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || !ANON) return null;
  try {
    const r = await fetch(`${BASE}/auth/v1/user`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const user = await verifyUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized — login required" }), { status: 401, headers: cors });
    }
    const rows = await runSql(`SELECT email,ts,ua FROM logins ORDER BY ts DESC LIMIT 50`);
    return new Response(JSON.stringify({ viewer: user.email, logins: rows }, null, 1), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
