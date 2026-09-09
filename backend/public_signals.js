// TradeOptix — Public Signals Feed — InsForge Edge Function (Deno/TS)
// Reads signals via InsForge SQL API (no PostgREST needed).
// App fetches: https://r3pjdfkc.function2.insforge.app/public_signals

const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";

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

export default async function handler(_req: Request): Promise<Response> {
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=60",
  };
  try {
    const rows = await runSql(
      "SELECT * FROM signals ORDER BY signal_time DESC LIMIT 20"
    );
    return new Response(JSON.stringify(rows), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors });
  }
}
