// TradeOptix — Login Logger — InsForge Edge Function (Deno/TS)
// Frontend login hone pe ye call karta hai — har login DB me record hota hai.
// Public: koi bhi logged-in user apna login record kar sakta hai (sirf email + time).

const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";

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
    const email = String(body.email || "unknown").slice(0, 120);
    const uid = String(body.uid || "").slice(0, 64);
    const ua = String(req.headers.get("user-agent") || "").slice(0, 200);
    await runSql(`INSERT INTO logins (email,uid,ua) VALUES ('${esc(email)}','${esc(uid)}','${esc(ua)}')`);
    await runSql(`INSERT INTO engine_logs (level,message) VALUES ('INFO','LOGIN: ${esc(email)}')`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
