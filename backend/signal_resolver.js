// TradeOptix — Signal Resolver v4 — InsForge Edge Function (Deno/TS)
// Har 5 minute chalao (cron "*/5 * * * *")
// ACTIVE signals check karta hai: TP hit → TRUE ✅, SL hit → FALSE ❌
// Result signals table me save hota hai + engine_logs me likha jata hai.

const BINANCE = "https://data-api.binance.vision/api/v3";
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

async function log(level: string, message: string): Promise<void> {
  try { await runSql(`INSERT INTO engine_logs (level,message) VALUES ('${esc(level)}','${esc(message)}')`); } catch { /* noop */ }
}

export default async function handler(_req: Request, _ctx: unknown): Promise<Response> {
  const rows = await runSql(
    `SELECT id,symbol,direction,entry_price,stop_loss,take_profit,signal_time FROM signals WHERE status='ACTIVE'`
  );
  if (!rows.length) {
    return new Response(JSON.stringify({ checked: 0, at: new Date().toISOString() }), { headers: { "Content-Type": "application/json" } });
  }

  const syms = [...new Set(rows.map((r: any) => r.symbol))];
  const tr = await fetch(`${BINANCE}/ticker/price`);
  const all = await tr.json();
  const price: Record<string, number> = {};
  for (const t of all) if (syms.includes(t.symbol)) price[t.symbol] = +t.price;

  const results: string[] = [];
  for (const s of rows) {
    const p = price[s.symbol];
    if (!p) { results.push(`-- ${s.symbol}: no price`); continue; }

    let status: string | null = null, exitP = 0, result = false, why = "";
    if (s.direction === 1) {
      if (p >= s.take_profit) { status = "TP_HIT"; exitP = s.take_profit; result = true; why = "TP"; }
      else if (p <= s.stop_loss) { status = "SL_HIT"; exitP = s.stop_loss; result = false; why = "SL"; }
    } else {
      if (p <= s.take_profit) { status = "TP_HIT"; exitP = s.take_profit; result = true; why = "TP"; }
      else if (p >= s.stop_loss) { status = "SL_HIT"; exitP = s.stop_loss; result = false; why = "SL"; }
    }
    // 7 din purana aur abhi bhi active → expiry (current PnL se true/false)
    const ageH = (Date.now() - new Date(s.signal_time).getTime()) / 3600000;
    if (!status && ageH > 168) {
      status = "EXPIRED"; exitP = p;
      result = s.direction === 1 ? p > s.entry_price : p < s.entry_price;
      why = "EXPIRY";
    }
    if (!status) { results.push(`.. ${s.symbol} open @ ${p}`); continue; }

    const pnl = (((exitP - s.entry_price) / s.entry_price) * 100 * s.direction);
    await runSql(
      `UPDATE signals SET status='${status}', result=${result}, exit_price=${exitP}, pnl_pct=${pnl.toFixed(3)}, resolved_at=now() WHERE id='${s.id}'`
    );
    results.push(`${result ? "TRUE" : "FALSE"} ${s.symbol} ${why} pnl=${pnl.toFixed(2)}%`);
    await log(result ? "TRUE" : "FALSE", `${s.symbol} ${s.direction === 1 ? "LONG" : "SHORT"} → ${result ? "TRUE ✅" : "FALSE ❌"} (${why}) | exit ${exitP} | PnL ${pnl.toFixed(2)}%`);

    // mobile alert on result (WhatsApp via CallMeBot)
    const WA_PHONE = Deno.env.get("WHATSAPP_PHONE");
    const WA_KEY = Deno.env.get("WHATSAPP_APIKEY");
    if (WA_PHONE && WA_KEY) {
      try {
        const icon = result ? "✅ TRUE" : "❌ FALSE";
        const msg = `${icon} ${s.symbol} ${s.direction === 1 ? "LONG" : "SHORT"} (${why})\nExit: ${exitP}\nPnL: ${pnl.toFixed(2)}%`;
        await fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(WA_PHONE)}&apikey=${WA_KEY}&text=${encodeURIComponent(msg)}`);
      } catch { /* alert fail = non-fatal */ }
    }
  }

  return new Response(JSON.stringify({ checked: rows.length, results, at: new Date().toISOString() }, null, 2), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
