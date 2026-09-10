// TradeOptix — Server Backtest v4 — InsForge Edge Function (Deno/TS)
// BACKEND-ONLY: ye poora backtest InsForge par compute hota hai — browser sirf result dikhata hai.
// Same strategy as signal_engine (EMA20/50/200 + Supertrend + VWAP + RSI cross + volume), fees 0.1%/side.
// Result backtest_runs table me bhi save hota hai.
// App fetches: https://r3pjdfkc.function2.insforge.app/server_backtest?symbol=BTCUSDT

const BINANCE = "https://data-api.binance.vision/api/v3";
const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";
const FEE = 0.001; // 0.1% per side

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

// ---- indicators (same as engine) ----
function ema(v: number[], n: number): number[] {
  const k = 2 / (n + 1); const o: number[] = []; let e = v[0];
  for (let i = 0; i < v.length; i++) { e = i === 0 ? v[i] : v[i] * k + e * (1 - k); o.push(e); }
  return o;
}
function rsi(c: number[], n = 14): number[] {
  const o = new Array(c.length).fill(50); let ag = 0, al = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], u = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= n) { ag += u / n; al += l / n; } else { ag = (ag * (n - 1) + u) / n; al = (al * (n - 1) + l) / n; }
    o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return o;
}
function atr(k: any[], n = 14): number[] {
  const o = new Array(k.length).fill(0); let a = 0;
  for (let i = 0; i < k.length; i++) {
    const pc = i > 0 ? k[i - 1].c : k[i].c;
    const tr = Math.max(k[i].h - k[i].l, Math.abs(k[i].h - pc), Math.abs(k[i].l - pc));
    a = i === 0 ? tr : (i >= n ? (a * (n - 1) + tr) / n : a + tr / n);
    o[i] = a;
  }
  return o;
}
function supertrend(k: any[], period = 10, mult = 3.0) {
  const n = k.length, st: (number | null)[] = new Array(n).fill(null), dir = new Array(n).fill(1);
  const a = atr(k, period);
  let fub: number | null = null, flb: number | null = null, pst: number | null = null, pfub: number | null = null, pflb: number | null = null;
  for (let i = period; i < n; i++) {
    const hl2 = (k[i].h + k[i].l) / 2, bu = hl2 + mult * a[i], bl = hl2 - mult * a[i];
    if (fub === null) { fub = bu; flb = bl; }
    else {
      fub = (bu < (pfub as number) || k[i - 1].c > (pfub as number)) ? bu : (pfub as number);
      flb = (bl > (pflb as number) || k[i - 1].c < (pflb as number)) ? bl : (pflb as number);
    }
    let cur: number;
    if (pst === null) cur = flb as number;
    else if (pst === pfub) cur = k[i].c <= (fub as number) ? (fub as number) : (flb as number);
    else cur = k[i].c >= (flb as number) ? (flb as number) : (fub as number);
    dir[i] = cur === fub ? -1 : 1;
    st[i] = cur; pst = cur; pfub = fub; pflb = flb;
  }
  return { st, dir };
}
function vwapSession(k: any[]): (number | null)[] {
  const o: (number | null)[] = new Array(k.length).fill(null);
  let cpv = 0, cv = 0, lastDay = -1;
  for (let i = 0; i < k.length; i++) {
    const day = new Date(k[i].t).getUTCDate();
    if (day !== lastDay) { cpv = 0; cv = 0; lastDay = day; }
    const tp = (k[i].h + k[i].l + k[i].c) / 3;
    cpv += tp * k[i].v; cv += k[i].v;
    o[i] = cv > 0 ? cpv / cv : null;
  }
  return o;
}

async function fetchAllKlines(sym: string, tf: string): Promise<any[]> {
  let all: any[] = [], endTime = 0;
  for (let p = 0; p < 10; p++) {           // up to 10000 candles (~27y) — safe loop
    const url = `${BINANCE}/klines?symbol=${sym}&interval=${tf}&limit=1000${endTime ? "&endTime=" + endTime : ""}`;
    const raw = await (await fetch(url)).json();
    if (!Array.isArray(raw) || !raw.length) break;
    all = raw.map((x: any[]) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] })).concat(all);
    if (raw.length < 1000) break;
    endTime = raw[0][0] - 1;
  }
  return all;
}

// ---- backtest: engine jaisi entry, TP ladder me TP1 pe 1/3, TP2 pe 1/3, TP3 pe 1/3 ----
function runBacktest(kl: any[]) {
  const closes = kl.map((x) => x.c);
  const eF = ema(closes, 20), eS = ema(closes, 50), eL = ema(closes, 200);
  const rs = rsi(closes), at = atr(kl);
  const { st, dir } = supertrend(kl);
  const vw = vwapSession(kl);
  let vs = 0; const volMA = new Array(kl.length).fill(null);
  for (let j = 0; j < kl.length; j++) { vs += kl[j].v; if (j >= 20) vs -= kl[j - 20].v; volMA[j] = j >= 19 ? vs / 20 : null; }

  const trades: any[] = [];
  let equity = 0, peak = 0, maxDD = 0, pos: any = null;

  const closePos = (exitP: number, j: number, why: string) => {
    const gross = ((exitP - pos.entry) / pos.entry) * pos.dir * 100;
    const pnl = gross - FEE * 200;
    trades.push({ side: pos.dir === 1 ? "LONG" : "SHORT", entry: +pos.entry.toFixed(6), exit: +exitP.toFixed(6),
      pnl: +pnl.toFixed(2), exitReason: why, time: new Date(kl[pos.i].t).toISOString(),
      holdBars: j - pos.i, hitTP1: pos.tp1Hit, hitTP2: pos.tp2Hit });
    equity += pnl;
    if (equity > peak) peak = equity;
    maxDD = Math.max(maxDD, peak - equity);
    pos = null;
  };

  for (let i = 210; i < kl.length; i++) {
    if (pos) {
      const c = kl[i];
      if (pos.dir === 1) {
        if (!pos.tp1Hit && c.h >= pos.tp1) { pos.tp1Hit = true; pos.size -= 1 / 3; }
        if (!pos.tp2Hit && c.h >= pos.tp2) { pos.tp2Hit = true; pos.size -= 1 / 3; }
        if (c.h >= pos.tp3) closePos(pos.tp3, i, "TP3");
        else if (c.l <= pos.sl) closePos(pos.sl, i, "SL");
        else if (i - pos.i >= 30) closePos(c.c, i, "TIME");
      } else {
        if (!pos.tp1Hit && c.l <= pos.tp1) { pos.tp1Hit = true; pos.size -= 1 / 3; }
        if (!pos.tp2Hit && c.l <= pos.tp2) { pos.tp2Hit = true; pos.size -= 1 / 3; }
        if (c.l <= pos.tp3) closePos(pos.tp3, i, "TP3");
        else if (c.h >= pos.sl) closePos(pos.sl, i, "SL");
        else if (i - pos.i >= 30) closePos(c.c, i, "TIME");
      }
      continue;
    }
    if (volMA[i] === null || vw[i] === null || st[i] === null || kl[i].v <= 1.2 * volMA[i]) continue;
    if (eF[i] > eS[i] && eS[i] > eL[i] && dir[i] === 1 && closes[i] > vw[i]
      && rs[i - 1] < 70 && rs[i] >= 70 && closes[i] > eF[i]) {
      const r = 2 * at[i];
      pos = { dir: 1, entry: closes[i], sl: closes[i] - r, tp1: closes[i] + r, tp2: closes[i] + 2 * r, tp3: closes[i] + 3 * r, i, size: 1, tp1Hit: false, tp2Hit: false };
    } else if (eF[i] < eS[i] && eS[i] < eL[i] && dir[i] === -1 && closes[i] < vw[i]
      && rs[i - 1] > 30 && rs[i] <= 30 && closes[i] < eF[i]) {
      const r = 2 * at[i];
      pos = { dir: -1, entry: closes[i], sl: closes[i] + r, tp1: closes[i] - r, tp2: closes[i] - 2 * r, tp3: closes[i] - 3 * r, i, size: 1, tp1Hit: false, tp2Hit: false };
    }
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const holds = trades.reduce((s, t) => s + t.holdBars, 0);
  return {
    trades,
    stats: {
      total: trades.length,
      wins: wins.length,
      winRate: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
      profitFactor: gl > 0 ? +(gw / gl).toFixed(2) : gw > 0 ? 99 : 0,
      returnPct: +equity.toFixed(2),
      maxDD: +maxDD.toFixed(2),
      avgWin: wins.length ? +(gw / wins.length).toFixed(2) : 0,
      avgLoss: losses.length ? +(gl / losses.length).toFixed(2) : 0,
      avgHoldBars: trades.length ? +(holds / trades.length).toFixed(1) : 0,
      candles: kl.length,
      from: kl.length ? new Date(kl[0].t).toISOString() : null,
      to: kl.length ? new Date(kl[kl.length - 1].t).toISOString() : null,
      ranAt: new Date().toISOString(),
      serverSide: true,
    },
  };
}

export default async function handler(req: Request): Promise<Response> {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const symbol = (new URL(req.url).searchParams.get("symbol") || "BTCUSDT").toUpperCase();
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error("bad symbol");
    const kl = await fetchAllKlines(symbol, "1d");
    if (kl.length < 300) throw new Error("insufficient data (" + kl.length + ")");
    const { trades, stats } = runBacktest(kl);
    try {
      await runSql(`INSERT INTO backtest_runs (symbol,stats) VALUES ('${esc(symbol)}','${esc(JSON.stringify({ ...stats, sample: trades.slice(0, 50) }))}'::jsonb)`);
      await runSql(`INSERT INTO engine_logs (level,message) VALUES ('INFO','Server backtest ${symbol}: ${stats.total} trades, ${stats.winRate}% win, PF ${stats.profitFactor}')`);
    } catch { /* table optional */ }
    return new Response(JSON.stringify({ symbol, ...stats, sample: trades.slice(0, 60) }, null, 1), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors });
  }
}
