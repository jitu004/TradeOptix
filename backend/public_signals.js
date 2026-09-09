// TradeOptix — Public Signals Feed — InsForge Edge Function (Deno/TS)
// Public (no auth) read-only feed for the app. Secrets stay server-side.
// App fetches: https://r3pjdfkc.insforge.dev/functions/public_signals

const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.insforge.dev";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";

export default async function handler(_req: Request): Promise<Response> {
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=60",
  };
  try {
    const r = await fetch(`${BASE}/rest/v1/signals?select=*&order=signal_time.desc&limit=20`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!r.ok) return new Response(JSON.stringify({ error: `upstream ${r.status}` }), { status: 502, headers: cors });
    const rows = await r.json();
    return new Response(JSON.stringify(rows), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors });
  }
}
