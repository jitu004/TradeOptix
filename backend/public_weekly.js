// TradeOptix — Weekly Report API — InsForge Edge Function (Deno/TS)
// Frontend ka "Weekly Report" panel yehi se data leta hai.
// App fetches: https://r3pjdfkc.function2.insforge.app/public_weekly

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
    "Cache-Control": "public, max-age=120",
  };
  try {
    const rows = await runSql(
      `SELECT id,symbol,timeframe,direction,entry_price,stop_loss,take_profit,status,result,pnl_pct,signal_time,resolved_at,tier
       FROM signals WHERE signal_time >= now() - interval '7 days' ORDER BY signal_time DESC LIMIT 200`
    );
    const resolved = rows.filter((r: any) => r.status !== "ACTIVE");
    const t = resolved.filter((r: any) => r.result === true).length;
    const f = resolved.length - t;
    const summary = {
      from: new Date(Date.now() - 7 * 86400e3).toISOString(),
      to: new Date().toISOString(),
      total: rows.length,
      resolved: resolved.length,
      pending: rows.length - resolved.length,
      trueCount: t,
      falseCount: f,
      truePct: resolved.length ? +((t / resolved.length) * 100).toFixed(1) : 0,
      falsePct: resolved.length ? +((f / resolved.length) * 100).toFixed(1) : 0,
      list: rows,
    };
    return new Response(JSON.stringify(summary), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors });
  }
}
