// TradeOptix — Approval Check — InsForge Edge Function (Deno/TS)
// After login the frontend checks: is this user admin-approved?
// approved -> access granted | pending -> "waiting for approval" screen

const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";
const ADMIN = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

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

export default async function handler(req: Request): Promise<Response> {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors });
    const body = await req.json();
    const email = String(body.email || "").toLowerCase().slice(0, 120);
    if (ADMIN.includes(email)) return new Response(JSON.stringify({ approved: true, status: "admin" }), { status: 200, headers: cors });
    const rows = await runSql(`SELECT status FROM access_requests WHERE email='${esc(email)}' LIMIT 1`);
    const status = rows[0]?.status ?? "none";
    return new Response(JSON.stringify({ approved: status === "approved", status }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
