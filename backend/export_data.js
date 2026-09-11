// TradeOptix — ML Data Export (ADMIN) — InsForge Edge Function (Deno/TS)
// Resolved signals + features ka CSV — future me offline ML model train karne ke liye.
// Call: https://r3pjdfkc.function2.insforge.app/export_data?days=90 (admin JWT required)

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
  const cors = { "Content-Type": "text/csv", "Access-Control-Allow-Origin": "*" };
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (token && ANON) {
      const ur = await fetch(`${BASE}/api/auth/sessions/current`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
      if (!ur.ok) return new Response("unauthorized", { status: 401 });
      const u = await ur.json();
      const email = String((u.user || {}).email || "").toLowerCase();
      if (!ADMIN.includes(email)) return new Response("admin only", { status: 403 });
    }
    const days = Math.min(365, Math.max(7, +(new URL(req.url).searchParams.get("days") || 90)));
    const rows = await runSql(`SELECT signal_time,symbol,timeframe,direction,tier,pattern,entry_price,stop_loss,take_profit,result,pnl_pct,exit_reason FROM signals WHERE status='RESOLVED' AND signal_time >= now() - interval '${days} days' ORDER BY signal_time`);
    const head = "signal_time,symbol,timeframe,direction,tier,pattern,entry,sl,tp,result,pnl_pct,exit_reason\n";
    const body = rows.map((r: any) => [r.signal_time, r.symbol, r.timeframe, r.direction, r.tier, r.pattern || "", r.entry_price, r.stop_loss, r.take_profit, r.result, r.pnl_pct, r.exit_reason].join(",")).join("\n");
    return new Response(head + body, { status: 200, headers: { ...cors, "Content-Disposition": `attachment; filename="signals_${days}d.csv"` } });
  } catch (e) {
    return new Response("error: " + String(e), { status: 500 });
  }
}
