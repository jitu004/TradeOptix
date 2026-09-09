// TradeOptix — Signal Engine v2 (Confluence) — InsForge Edge Function (Deno/TS)
// Attach schedule (cron every 30 min). DB via InsForge SQL API.
// Backtest (5y, fees incl): BTC 57.1%/PF 2.24 · ETH 61.5%/PF 2.50 · LINK 53.3%/PF 1.86
// LONG : EMA20>EMA50>EMA200 + Supertrend bull + price>VWAP + RSI cross >70
// SHORT: EMA20<EMA50<EMA200 + Supertrend bear + price<VWAP + RSI cross <30
// SL = 2xATR · TP ladder 1R/2R/3R

const BINANCE = "https://data-api.binance.vision/api/v3";
const COINS = ["BTCUSDT", "ETHUSDT", "LINKUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "SOLUSDT"];
const RSI_BUY = 70, RSI_SELL = 30, SL_ATR = 2.0, RR = 3.0;
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

// ---------- indicators ----------
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
function vwap(k: any[]): (number | null)[] {
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

// ---------- data ----------
async function fetchKlines(sym: string): Promise<any[]> {
  const r = await fetch(`${BINANCE}/klines?symbol=${sym}&interval=1d&limit=400`);
  const raw = await r.json();
  return raw.map((x: any[]) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }));
}

// ---------- confluence signal ----------
function detect(kl: any[]) {
  const closes = kl.map((x) => x.c);
  if (closes.length < 210) return null;
  const eF = ema(closes, 20), eS = ema(closes, 50), eL = ema(closes, 200);
  const rs = rsi(closes), at = atr(kl);
  const { st, dir } = supertrend(kl);
  const vw = vwap(kl);
  const i = kl.length - 2;
  const entry = closes[closes.length - 1], v = vw[i];
  if (v === null) return null;
  if (eF[i] > eS[i] && eS[i] > eL[i] && st[i] !== null && dir[i] === 1
    && closes[i] > v && rs[i - 1] < RSI_BUY && rs[i] >= RSI_BUY && closes[i] > eF[i]) {
    const sl = entry - SL_ATR * at[i], r = SL_ATR * at[i];
    return { dir: 1, entry, sl, tp1: entry + r, tp2: entry + 2 * r, tp3: entry + 3 * r, atr: at[i] };
  }
  if (eF[i] < eS[i] && eS[i] < eL[i] && st[i] !== null && dir[i] === -1
    && closes[i] < v && rs[i - 1] > RSI_SELL && rs[i] <= RSI_SELL && closes[i] < eF[i]) {
    const sl = entry + SL_ATR * at[i], r = SL_ATR * at[i];
    return { dir: -1, entry, sl, tp1: entry - r, tp2: entry - 2 * r, tp3: entry - 3 * r, atr: at[i] };
  }
  return null;
}

// ---------- main ----------
export default async function handler(_req: Request, _ctx: unknown): Promise<Response> {
  const logs: string[] = [];
  for (const sym of COINS) {
    try {
      const kl = await fetchKlines(sym);
      const sig = detect(kl);
      if (!sig) { logs.push(`-- ${sym}: no setup`); continue; }
      const recent = await runSql(
        `SELECT 1 FROM signals WHERE symbol='${esc(sym)}' AND signal_time >= now() - interval '24 hours' LIMIT 1`
      );
      if (recent.length > 0) { logs.push(`-- ${sym}: already signalled (24h)`); continue; }
      await runSql(
        `INSERT INTO signals (symbol,timeframe,direction,entry_price,stop_loss,take_profit,atr,rr_ratio,status) VALUES ` +
        `('${esc(sym)}','1d',${sig.dir},${sig.entry},${sig.sl},${sig.tp3},${sig.atr},${RR},'ACTIVE')`
      );
      logs.push(`OK ${sym} ${sig.dir === 1 ? "LONG" : "SHORT"} @ ${sig.entry.toFixed(4)} SL ${sig.sl.toFixed(4)} TP ${sig.tp3.toFixed(4)}`);
    } catch (e) { logs.push(`WARN ${sym}: ${String(e)}`); }
  }
  return new Response(JSON.stringify({ scanned: COINS.length, at: new Date().toISOString(), logs }, null, 2), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
