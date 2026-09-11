// TradeOptix — Signal Resolver v5 — InsForge Edge Function (Deno/TS)
// Runs every 5 min — ACTIVE signals checked with TP LADDER tracking:
//   TP1 hit -> 🎯 milestone email (profit% + period) — trade STILL active
//   TP2 hit -> 🎯 milestone email
//   TP3 hit -> ✅ FINAL TRUE (trade closed)
//   SL hit  -> ❌ FINAL FALSE (trade closed)
//   7 days  -> ⌛ expiry (result by PnL)
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

async function sendEmail(subject: string, text: string): Promise<boolean> {
  const BREVO = Deno.env.get("BREVO_KEY") ?? "";
  const ADMIN = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",")[0]?.trim();
  if (!BREVO || !ADMIN) return false;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO, "Content-Type": "application/json" },
      body: JSON.stringify({ sender: { name: "TradeOptix Signals", email: Deno.env.get("ALERT_SENDER") || "noreply@tradeoptix.app" }, to: [{ email: ADMIN }], subject, textContent: text }),
    });
    return r.ok;
  } catch { return false; }
}

function fmtDur(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr ${m % 60} min`;
}

export default async function handler(_req: Request): Promise<Response> {
  const rows = await runSql(
    `SELECT id,symbol,direction,entry_price,stop_loss,take_profit,signal_time,tp_hit,sl_current FROM signals WHERE status='ACTIVE'`
  );
  if (!rows.length) return new Response(JSON.stringify({ checked: 0, at: new Date().toISOString() }), { headers: { "Content-Type": "application/json" } });

  const syms = [...new Set(rows.map((r: any) => r.symbol))];
  const tr = await fetch(`${BINANCE}/ticker/price`);
  const all = await tr.json();
  const price: Record<string, number> = {};
  for (const t of all) if (syms.includes(t.symbol)) price[t.symbol] = +t.price;

  const results: string[] = [];
  for (const s of rows) {
    const p = price[s.symbol];
    if (!p) { results.push(`-- ${s.symbol}: no price`); continue; }
    const dir = s.direction === 1 ? 1 : -1;
    const entry = +s.entry_price, sl = +s.stop_loss;
    const slC = s.sl_current != null ? +s.sl_current : sl;   // breakeven-aware SL
    const risk = Math.abs(entry - sl) || 1e-9;
    const tp1 = entry + dir * risk, tp2 = entry + dir * 2 * risk, tp3 = +s.take_profit;
    const ageMs = Date.now() - new Date(s.signal_time).getTime();
    const period = fmtDur(ageMs);
    const pct = (target: number) => (((target - entry) / entry) * 100 * dir).toFixed(2);

    // ---- ENTRY CONFIRMED (first resolver touch — VIP style "entries achieved") ----
    if ((s.tp_hit || 0) === 0) {
      await runSql(`UPDATE signals SET tp_hit=-1 WHERE id='${s.id}'`);
      await sendEmail(`✅ ENTRY CONFIRMED: ${s.symbol} ${dir === 1 ? "LONG" : "SHORT"}`,
        `✅ ${s.symbol} ${dir === 1 ? "LONG" : "SHORT"}\nEntry achieved @ ${entry}\nSL: ${sl} | TP1: ${tp1.toFixed(6)} | TP2: ${tp2.toFixed(6)} | TP3: ${tp3}\nTrade is now ACTIVE\nSignal time: ${new Date(s.signal_time).toLocaleString("en-GB")}`);
      await log("INFO", `${s.symbol} ✅ ENTRY CONFIRMED @ ${entry}`);
      results.push(`ENTRY ${s.symbol}`);
    }

    // ---- SL first (final) ----
    const slHit = dir === 1 ? p <= slC : p >= slC;
    if (slHit) {
      const pnl = (((slC - entry) / entry) * 100 * dir);
      await runSql(`UPDATE signals SET status='SL_HIT', result=false, exit_price=${slC}, pnl_pct=${pnl.toFixed(3)}, resolved_at=now() WHERE id='${s.id}'`);
      await sendEmail(`❌ SL HIT: ${s.symbol} ${dir === 1 ? "LONG" : "SHORT"}`, `❌ ${s.symbol} ${dir === 1 ? "LONG" : "SHORT"}\nStop Loss hit\nExit: ${slC}\nPnL: ${pnl.toFixed(2)}%\nPeriod: ${period}`);
      await log("FALSE", `${s.symbol} ${dir === 1 ? "LONG" : "SHORT"} → FALSE ❌ (SL) | exit ${sl} | PnL ${pnl.toFixed(2)}% | ${period}`);
      results.push(`FALSE ${s.symbol} SL`);
      continue;
    }

    // ---- TP ladder ----
    let lvl = 0;
    if (dir === 1) { if (p >= tp1) lvl = 1; if (p >= tp2) lvl = 2; if (p >= tp3) lvl = 3; }
    else { if (p <= tp1) lvl = 1; if (p <= tp2) lvl = 2; if (p <= tp3) lvl = 3; }
    const cur = (s.tp_hit || 0) > 0 ? s.tp_hit : 0;

    if (lvl >= 3) {
      const pnl = ((tp3 - entry) / entry) * 100 * dir;
      await runSql(`UPDATE signals SET status='TP_HIT', result=true, exit_price=${tp3}, pnl_pct=${pnl.toFixed(3)}, resolved_at=now(), tp_hit=3 WHERE id='${s.id}'`);
      await sendEmail(`✅ TP3 FINAL: ${s.symbol} ${dir === 1 ? "LONG" : "SHORT"}`, `✅✅✅ ${s.symbol} ${dir === 1 ? "LONG" : "SHORT"}\nTP3 FINAL — trade closed\nExit: ${tp3}\nPnL: ${pnl.toFixed(2)}%\nPeriod: ${period}`);
      await log("TRUE", `${s.symbol} ${dir === 1 ? "LONG" : "SHORT"} → TRUE ✅ (TP3 FINAL) | exit ${tp3} | PnL ${pnl.toFixed(2)}% | ${period}`);
      results.push(`TRUE ${s.symbol} TP3`);
    } else if (lvl > cur) {
      // TRAILING STOP LADDER: TP1 -> SL=entry (breakeven) | TP2 -> SL=TP1 (profit locked) | TP3 -> final
      const beUpdate = lvl === 1 ? `, sl_current=${entry}` : lvl === 2 ? `, sl_current=${tp1}` : "";
      await runSql(`UPDATE signals SET tp_hit=${lvl}${beUpdate} WHERE id='${s.id}'`);
      const lbl = `TP${lvl}`;
      const tval = lvl === 1 ? tp1 : tp2;
      await sendEmail(`🎯 ${lbl} HIT: ${s.symbol} ${dir === 1 ? "LONG" : "SHORT"}`, `🎯 ${s.symbol} ${dir === 1 ? "LONG" : "SHORT"}\n${lbl} achieved!\nProfit: ${pct(tval)}%\nPeriod: ${period}\nTrade still running — next target ${lvl === 1 ? "TP2" : "TP3"}${lvl === 1 ? "\nSL moved to BREAKEVEN @ entry — no loss possible now" : lvl === 2 ? `\nSL moved to TP1 — +${pct(tp1)}% PROFIT LOCKED in` : ""}`);
      await log("TRUE", `${s.symbol} → 🎯 ${lbl} HIT | profit ${pct(tval)}% | ${period}`);
      results.push(`MILESTONE ${s.symbol} ${lbl}`);
    } else if (ageMs > 168 * 3600e3) {
      const result = dir === 1 ? p > entry : p < entry;
      await runSql(`UPDATE signals SET status='EXPIRED', result=${result}, exit_price=${p}, pnl_pct=${(((p - entry) / entry) * 100 * dir).toFixed(3)}, resolved_at=now() WHERE id='${s.id}'`);
      await log("INFO", `${s.symbol} expired → ${result ? "TRUE" : "FALSE"}`);
      results.push(`EXPIRED ${s.symbol}`);
    } else {
      results.push(`.. ${s.symbol} open @${p} (tp${cur})`);
    }
  }
  return new Response(JSON.stringify({ checked: rows.length, results, at: new Date().toISOString() }, null, 1), { status: 200, headers: { "Content-Type": "application/json" } });
}
