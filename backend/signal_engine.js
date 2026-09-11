// TradeOptix — Signal Engine v4.1 (sentiment-gated, multi-timeframe, quota: ~10/day)
// InsForge Edge Function (Deno/TS) — Attach schedule: every 30 min (cron "*/30 * * * *")
//
// REAL-TIME CHART READING (MTF): signal tabhi milta hai jab chart ke multiple timeframes align hon —
//   1D trend (EMA stack) → 4H setup (confluence detect) → dono same direction me hon
// MARKET SENTIMENT GATE: `sentiment` table ka latest score quality decide karta hai —
//   score >= 55 (Greed)  → LONG allowed, SHORT blocked (extreme greed >= 75 pe SHORT allowed — fade)
//   score <= 45 (Fear)   → SHORT allowed, LONG blocked (extreme fear <= 25 pe LONG allowed — dip buy)
//   45-55 neutral        → dono allowed, quality tier se decide
//   Sentiment-aligned signal ko +15% score boost milta hai
// QUOTA: 10/day — pehle 1D full confluence (T1), phir 4H tiered-relax (T2→T4) se fill.
// Har action engine_logs me likha jata hai (frontend Live Logs panel).

const BINANCE = "https://data-api.binance.vision/api/v3";
const TOP_N = 40;
const QUOTA_PER_DAY = 10;
const RSI_BUY = 70, RSI_SELL = 30, SL_ATR = 2.0, RR = 3.0;

// Correlation groups — same-group coins move together; only ONE active trade per group (portfolio risk control)
const CORR_GROUPS: Record<string, string> = {
  BTCUSDT: "G1", ETHUSDT: "G1", BNBUSDT: "G1",
  SOLUSDT: "G2", AVAXUSDT: "G2", DOTUSDT: "G2", MATICUSDT: "G2", NEARUSDT: "G2", ATOMUSDT: "G2", ADAUSDT: "G2", LINKUSDT: "G2", TRXUSDT: "G2", SUIUSDT: "G2", APTUSDT: "G2",
  DOGEUSDT: "G3", SHIBUSDT: "G3", PEPEUSDT: "G3", BONKUSDT: "G3", WIFUSDT: "G3", FLOKIUSDT: "G3",
  XRPUSDT: "G4", LTCUSDT: "G4", BCHUSDT: "G4", XLMUSDT: "G4",
};
const corrGroup = (sym: string): string => CORR_GROUPS[sym] ?? sym; // unknown coins = own group

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
  try { await runSql(`INSERT INTO engine_logs (level,message) VALUES ('${esc(level)}','${esc(message)}')`); } catch (e) { console.error("log fail:", String(e)); }
}

// ---------- sentiment gate ----------
async function getSentiment(): Promise<{ score: number; label: string; regime: string }> {
  try {
    const rows = await runSql(`SELECT score,label,components FROM sentiment ORDER BY ts DESC LIMIT 1`);
    if (rows.length) {
      let regime = "RANGE";
      try { regime = (JSON.parse(rows[0].components || "{}").regime) || "RANGE"; } catch { /* */ }
      return { score: rows[0].score, label: rows[0].label, regime };
    }
  } catch { /* table missing → neutral */ }
  return { score: 50, label: "NEUTRAL", regime: "RANGE" };
}

async function getNewsScore(): Promise<number> {
  try {
    const rows = await runSql(`SELECT score FROM news_score ORDER BY ts DESC LIMIT 1`);
    if (rows.length) return +rows[0].score || 0;
  } catch { /* */ }
  return 0;
}

function sentimentAllows(score: number, dir: 1 | -1): boolean {
  if (score >= 75) return dir === -1;   // extreme greed — sirf SHORT (fade)
  if (score <= 25) return dir === 1;    // extreme fear — sirf LONG (dip buy)
  if (score >= 55) return dir === 1;    // greed — LONG
  if (score <= 45) return dir === -1;   // fear — SHORT
  return true;                          // neutral
}

function regimeAllows(regime: string, dir: 1 | -1): boolean {
  if (regime === "BEAR") return dir === -1;   // bear market — LONGs restricted
  if (regime === "BULL") return dir === 1;    // bull market — SHORTs restricted
  return true;
}

// ---------- self-learning weights — HAR RUN pe update (7d recent + 14d stable blend) ----------
type Weights = { tierW: Record<string, number>; patW: number; dirW: Record<string, number> };
let lastLearnDay = "";

async function getWeights(): Promise<Weights> {
  const def: Weights = { tierW: { "1": 1, "2": 1, "3": 1, "4": 1 }, patW: 1, dirW: { "1": 1, "-1": 1 } };
  const calc = async (days: number): Promise<Weights | null> => {
    const rows = await runSql(`SELECT tier, direction, pattern, result, tp_hit, count(*)::int AS c FROM signals WHERE status='RESOLVED' AND signal_time >= now() - interval '${days} days' GROUP BY 1,2,3,4,5`);
    if (!rows.length) return null;
    // LADDER CREDIT: TP3 final=1.0, expired-win=0.7, hit TP2 then SL=0.6, hit TP1 then SL=0.35, straight SL=0
    const creditOf = (r: any): number => r.result === true ? (r.tp_hit >= 3 ? 1.0 : 0.7) : r.tp_hit >= 2 ? 0.6 : r.tp_hit >= 1 ? 0.35 : 0;
    const acc = (o: Record<string, { t: number; f: number }>, k: string, r: any) => {
      o[k] = o[k] || { t: 0, f: 0 };
      o[k].t += creditOf(r) * +r.c;   // t = total credit score
      o[k].f += +r.c;                 // f = count
    };
    const tier: Record<string, { t: number; f: number }> = {};
    const dir: Record<string, { t: number; f: number }> = {};
    const pat: Record<string, { t: number; f: number }> = {};
    let anyTier = false;
    for (const r of rows) {
      acc(tier, String(r.tier), r);
      acc(dir, String(r.direction), r);
      if (r.pattern) acc(pat, "p", r); else acc(pat, "n", r);
      anyTier = true;
    }
    if (!anyTier) return null;
    const w = (bb: { t: number; f: number } | undefined): number => {
      if (!bb) return 1;
      const cnt = bb.f;
      if (cnt < 3) return 1;
      const q = bb.t / cnt;   // avg ladder credit 0..1
      return Math.max(0.6, Math.min(1.4, 0.6 + q * 0.8));   // q=0 -> 0.6, q=0.5 -> 1.0, q=1 -> 1.4
    };
    const out: Weights = { tierW: {}, patW: 1, dirW: {} };
    for (const k of Object.keys(tier)) out.tierW[k] = w(tier[k]);
    for (const k of Object.keys(dir)) out.dirW[k] = w(dir[k]);
    const pw = w(pat["p"]), nw = w(pat["n"]);
    out.patW = pw * (pw >= nw ? 1.05 : 0.95);
    return out;
  };
  try {
    const w7 = await calc(7);     // roz ka recent behaviour — fast adaptation
    const w14 = await calc(14);   // stable base
    const pick = (a2: number | undefined, b2: number | undefined) => (a2 !== undefined && b2 !== undefined) ? 0.6 * a2 + 0.4 * b2 : (a2 ?? b2 ?? 1);
    for (const k of ["1", "2", "3", "4"]) def.tierW[k] = pick(w7?.tierW[k], w14?.tierW[k]);
    for (const k of ["1", "-1"]) def.dirW[k] = pick(w7?.dirW[k], w14?.dirW[k]);
    def.patW = pick(w7?.patW, w14?.patW);

    // DAILY LEARN log — roz ek baar poori report
    const today = new Date().toISOString().slice(0, 10);
    if (today !== lastLearnDay) {
      lastLearnDay = today;
      await log("INFO", `📚 DAILY LEARN [${today}] weights: T1=${def.tierW["1"].toFixed(2)} T2=${def.tierW["2"].toFixed(2)} T3=${def.tierW["3"].toFixed(2)} T4=${def.tierW["4"].toFixed(2)} | pattern=${def.patW.toFixed(2)} | LONG=${def.dirW["1"].toFixed(2)} SHORT=${def.dirW["-1"].toFixed(2)}`);
    }
  } catch { /* neutral */ }
  return def;
}

// ---------- coin universe ----------
async function topCoins(): Promise<{ coins: string[]; pumps: Set<string> }> {
  const r = await fetch(`${BINANCE}/ticker/24hr`);
  const all = await r.json();
  const pumps = new Set<string>();
  for (const t of all) {
    if (t.symbol.endsWith("USDT") && Math.abs(+t.priceChangePercent) > 12) pumps.add(t.symbol); // pump/dump zone
  }
  const coins = all
    .filter((t: any) => t.symbol.endsWith("USDT") && !/(UP|DOWN|BULL|BEAR)/.test(t.symbol) && +t.lastPrice > 0)
    .sort((a: any, b: any) => +b.quoteVolume - +a.quoteVolume)
    .slice(0, TOP_N)
    .map((t: any) => t.symbol);
  return { coins, pumps };
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

async function fetchKlines(sym: string, tf: string): Promise<any[]> {
  const r = await fetch(`${BINANCE}/klines?symbol=${sym}&interval=${tf}&limit=300`);
  const raw = await r.json();
  return raw.map((x: any[]) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }));
}

// ---------- 1D trend direction (MTF align ke liye) ----------
function trend1d(kl: any[]): 1 | -1 | 0 {
  if (kl.length < 60) return 0;
  const closes = kl.map((x) => x.c);
  const eF = ema(closes, 20), eS = ema(closes, 50);
  const i = closes.length - 2;
  if (eF[i] > eS[i]) return 1;
  if (eF[i] < eS[i]) return -1;
  return 0;
}

// ---------- candlestick patterns (last closed candle) ----------
function patterns(kl: any[]) {
  const i = kl.length - 2;
  if (i < 1) return { bull: false, bear: false };
  const c = kl[i], p = kl[i - 1];
  const body = Math.abs(c.c - c.o), range = Math.max(c.h - c.l, 1e-12);
  const pBull = p.c > p.o, pBear = p.c < p.o;
  const cBull = c.c > c.o, cBear = c.c < c.o;
  const bullEngulf = pBear && cBull && c.c >= p.o && c.o <= p.c;
  const bearEngulf = pBull && cBear && c.c <= p.o && c.o >= p.c;
  const lowerWick = Math.min(c.o, c.c) - c.l;
  const upperWick = c.h - Math.max(c.o, c.c);
  const hammer = range > 3 * body && lowerWick / range > 0.6;
  const shooting = range > 3 * body && upperWick / range > 0.6;
  return { bull: bullEngulf || hammer, bear: bearEngulf || shooting, name: bullEngulf ? 'BullEngulf' : hammer ? 'Hammer' : bearEngulf ? 'BearEngulf' : shooting ? 'ShootingStar' : '' };
}

// ---------- tiered detection ----------
// Tier 1-3: RSI CROSS based (quality events, strict)
// Tier 4:   RSI ZONE based (state-based — quota fill ke liye, zyada frequent)
function detect(kl: any[], tier: number, p: any) {
  const closes = kl.map((x) => x.c);
  if (closes.length < 210) return null;
  const eF = ema(closes, 20), eS = ema(closes, 50), eL = ema(closes, 200);
  const rs = rsi(closes), at = atr(kl);
  const { st, dir } = supertrend(kl);
  const vw = vwap(kl);
  let vs = 0; const volMA = new Array(kl.length).fill(null);
  for (let j = 0; j < kl.length; j++) { vs += kl[j].v; if (j >= 20) vs -= kl[j - 20].v; volMA[j] = j >= 19 ? vs / 20 : null; }
  const i = kl.length - 2;
  const entry = closes[closes.length - 1], v = vw[i];
  const pat = patterns(kl);
  if (volMA[i] === null) return null;
  const volOK = tier >= 2 || kl[i].v > p.volMult * volMA[i];
  const stOK = tier >= 4 || (st[i] !== null && dir[i] === 1);
  const stOKS = tier >= 4 || (st[i] !== null && dir[i] === -1);

  // ---- Pattern-based (tier>=2): trend + supertrend + volume + candlestick pattern ----
  if (tier >= 2 && pat.bull && eF[i] > eS[i] && eS[i] > eL[i] && stOK
    && (v === null || closes[i] > v) && volOK && closes[i] > eF[i]) {
    const r = p.slMult * at[i];
    return { dir: 1 as const, entry, sl: entry - r, tp1: entry + r, tp2: entry + 2 * r, tp3: entry + 3 * r, atr: at[i], score: 1.25 * kl[i].v / (volMA[i] || 1), pat: pat.name };
  }
  if (tier >= 2 && pat.bear && eF[i] < eS[i] && eS[i] < eL[i] && stOKS
    && (v === null || closes[i] < v) && volOK && closes[i] < eF[i]) {
    const r = p.slMult * at[i];
    return { dir: -1 as const, entry, sl: entry + r, tp1: entry - r, tp2: entry - 2 * r, tp3: entry - 3 * r, atr: at[i], score: 1.25 * kl[i].v / (volMA[i] || 1), pat: pat.name };
  }

  // ---- Tier 4: state-based (RSI zone, no cross needed) — frequent setups for quota ----
  if (tier >= 4) {
    if (eF[i] > eS[i] && eS[i] > eL[i] && closes[i] > eF[i] && rs[i] >= p.zLMin && rs[i] <= p.zLMax) {
      const r = p.slMult * at[i];
      return { dir: 1 as const, entry, sl: entry - r, tp1: entry + r, tp2: entry + 2 * r, tp3: entry + 3 * r, atr: at[i], score: kl[i].v / (volMA[i] || 1) };
    }
    if (eF[i] < eS[i] && eS[i] < eL[i] && closes[i] < eF[i] && rs[i] <= p.zSMax && rs[i] >= p.zSMin) {
      const r = p.slMult * at[i];
      return { dir: -1 as const, entry, sl: entry + r, tp1: entry - r, tp2: entry - 2 * r, tp3: entry - 3 * r, atr: at[i], score: kl[i].v / (volMA[i] || 1) };
    }
    return null;
  }

  // ---- Tier 1-3: cross-based ----
  if (eF[i] > eS[i] && eS[i] > eL[i] && stOK && (tier >= 3 || (v !== null && closes[i] > v))
    && rs[i - 1] < p.rsiBuy && rs[i] >= p.rsiBuy && closes[i] > eF[i] && volOK) {
    const r = SL_ATR * at[i];
    return { dir: 1 as const, entry, sl: entry - r, tp1: entry + r, tp2: entry + 2 * r, tp3: entry + 3 * r, atr: at[i], score: (pat.bull ? 1.3 : 1) * kl[i].v / (volMA[i] || 1), pat: pat.bull ? pat.name : '' };
  }
  if (eF[i] < eS[i] && eS[i] < eL[i] && stOKS && (tier >= 3 || (v !== null && closes[i] < v))
    && rs[i - 1] > p.rsiSell && rs[i] <= p.rsiSell && closes[i] < eF[i] && volOK) {
    const r = SL_ATR * at[i];
    return { dir: -1 as const, entry, sl: entry + r, tp1: entry - r, tp2: entry - 2 * r, tp3: entry - 3 * r, atr: at[i], score: (pat.bear ? 1.3 : 1) * kl[i].v / (volMA[i] || 1), pat: pat.bear ? pat.name : '' };
  }
  return null;
}

// ---------- Strategy Lab config (weekly self-optimized params) ----------
async function getStrategy(): Promise<any> {
  const def = { rsiBuy: 70, rsiSell: 30, zLMin: 55, zLMax: 75, zSMin: 25, zSMax: 45, slMult: 2.0, volMult: 1.2 };
  try {
    const rows = await runSql(`SELECT config FROM strategy_config WHERE id=1 LIMIT 1`);
    if (rows.length) return { ...def, ...(JSON.parse(rows[0].config || "{}").params || {}) };
  } catch { /* defaults */ }
  return def;
}

// Parallel scan: 8 coins at a time (gateway-timeout se bachne ke liye)
async function scanBatch<T>(items: string[], fn: (sym: string) => Promise<T | null>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < items.length; i += 8) {
    const res = await Promise.all(items.slice(i, i + 8).map(fn));
    for (const r of res) if (r) out.push(r);
  }
  return out;
}

// ---------- main ----------
export default async function handler(_req: Request, _ctx: unknown): Promise<Response> {
  const started = Date.now();
  let coins: string[] = [];
  let pumpSet = new Set<string>();
  try { const t = await topCoins(); coins = t.coins; pumpSet = t.pumps; }
  catch (e) { await log("ERROR", "topCoins failed: " + String(e)); return new Response(JSON.stringify({ error: String(e) }), { status: 502 }); }

  const sent = await getSentiment();
  const newsScore = await getNewsScore();
  const strat = await getStrategy();
  // AUTO-QUOTA: recent 7d true% -> quota self-regulate (55%+ => 15, <40% => 6, else 10)
  let quotaToday = QUOTA_PER_DAY;
  try {
    const q = await runSql(`SELECT count(*)::int AS c, count(*) FILTER (WHERE result=true)::int AS t FROM signals WHERE status='RESOLVED' AND resolved_at >= now() - interval '7 days'`);
    if (q[0] && q[0].c >= 10) {
      const tp = q[0].t / q[0].c;
      quotaToday = tp > 0.55 ? 15 : tp < 0.40 ? 6 : 10;
      if (quotaToday !== QUOTA_PER_DAY) await log("INFO", `Auto-quota: 7d true%=${(tp * 100).toFixed(0)} → quota aaj ${quotaToday}/day`);
    }
  } catch { /* default quota */ }
  const sentEff = Math.max(0, Math.min(100, sent.score + newsScore * 2));  // news sentiment ko shift karta hai
  const qualityOnly = Math.abs(newsScore) >= 4;   // major news event = sirf best quality
  const weights = await getWeights();
  if (qualityOnly) await log("WARN", `📰 NEWS MODE ON (score ${newsScore}) — sirf T1 quality signals`);
  if (sent.regime !== "RANGE") await log("INFO", `Regime: ${sent.regime}`);
  await log("INFO", `Learned weights: T1=${(weights.tierW["1"]||1).toFixed(2)} T2=${(weights.tierW["2"]||1).toFixed(2)} T3=${(weights.tierW["3"]||1).toFixed(2)} T4=${(weights.tierW["4"]||1).toFixed(2)} | pattern=${weights.patW.toFixed(2)} | LONG=${(weights.dirW["1"]||1).toFixed(2)} SHORT=${(weights.dirW["-1"]||1).toFixed(2)}`);
  let madeToday = (await runSql(`SELECT count(*)::int AS c FROM signals WHERE signal_time >= now()::date`))[0]?.c ?? 0;
  const logs: string[] = [`sentiment ${sent.score}/100 ${sent.label} — quota ${madeToday}/${quotaToday}`];
  await log("INFO", `Engine run — sentiment ${sent.score}/100 (${sent.label}), quota ${madeToday}/${quotaToday}`);

  const doneRows = await runSql(`SELECT DISTINCT symbol FROM signals WHERE signal_time >= now()::date`);
  const doneToday = new Set(doneRows.map((r: any) => r.symbol));
  const made: string[] = [];
  const trendCache = new Map<string, 1 | -1 | 0>();       // 1D trend per symbol — MTF align

  async function t1d(sym: string): Promise<1 | -1 | 0> {
    if (!trendCache.has(sym)) {
      try { trendCache.set(sym, trend1d(await fetchKlines(sym, "1d"))); }
      catch { trendCache.set(sym, 0); }
    }
    return trendCache.get(sym) ?? 0;
  }

  async function insert(sym: string, tf: string, sig: any, tier: number, sentAligned: boolean): Promise<void> {
    // ONE COIN = ONE ACTIVE SIGNAL — best wins; CORRELATION FILTER — one risk per group
    try {
      const act = await runSql(`SELECT id,symbol,tier,pattern FROM signals WHERE status='ACTIVE'`);
      const symRow = act.find((x: any) => x.symbol === sym);
      if (symRow) {
        const newQ = (5 - tier) + (sig.pat ? 0.5 : 0);            // LOW tier = HIGH quality (T1 best)
        const curQ = (5 - (+symRow.tier)) + (symRow.pattern ? 0.5 : 0);
        if (newQ > curQ) {                                         // strictly better -> replace (Q bounded — no infinite flip)
          await runSql(`UPDATE signals SET status='CANCELLED', resolved_at=now() WHERE id='${symRow.id}'`);
          await log("INFO", `${sym}: SIGNAL UPGRADE — old T${symRow.tier} CANCELLED, new T${tier}${sig.pat ? " (pattern)" : ""} ACTIVE`);
        } else {
          logs.push(`-- ${sym}: already ACTIVE (T${symRow.tier}) — new T${tier} skipped`);
          return;
        }
      } else if (act.length) {
        const myGroup = corrGroup(sym);
        const clash = act.find((x: any) => corrGroup(x.symbol) === myGroup);
        if (clash) {
          logs.push(`-- ${sym}: correlation filter — ${clash.symbol} already ACTIVE (group ${myGroup})`);
          await log("INFO", `${sym}: skipped — correlated with ACTIVE ${clash.symbol} (group ${myGroup})`);
          return;
        }
      }
    } catch { /* continue */ }
    const tw = weights.tierW[String(tier)] ?? 1, dw = weights.dirW[String(sig.dir)] ?? 1, pw = sig.pat ? weights.patW : 1;
    const wMult = tw * dw * pw;
    if (wMult !== 1) sig.score = sig.score * wMult;
    const patCol = sig.pat ? `'${esc(sig.pat)}'` : "NULL";
    await runSql(`INSERT INTO signals (symbol,timeframe,direction,entry_price,stop_loss,take_profit,atr,rr_ratio,status,tier,pattern) VALUES ('${esc(sym)}','${tf}',${sig.dir},${sig.entry},${sig.sl},${sig.tp3},${sig.atr},${RR},'ACTIVE',${tier},${patCol})`);
    madeToday++;
    made.push(`${sym} ${tf} T${tier}`);
    const tag = sentAligned ? "sentiment-aligned ⭐" : tier === 1 ? "full confluence" : `tier ${tier} relaxed`;
    if (sig.pat) sig.score = sig.score; // pattern already in score
    logs.push(`OK ${sym} ${tf} T${tier} ${sig.dir === 1 ? "LONG" : "SHORT"}`);
    await log("SIGNAL", `${sym} ${tf.toUpperCase()} ${sig.dir === 1 ? "LONG" : "SHORT"} @ ${sig.entry.toFixed(4)} (${tag}, quota ${madeToday}/${quotaToday})`);
    await whatsappAlert(sym, tf, sig, tier);
  }

  // --- mobile alert: EMAIL (Brevo — reliable) + WhatsApp (Twilio/CallMeBot, optional) ---
  async function sendAlertEmail(subject: string, text: string): Promise<boolean> {
    const BREVO = Deno.env.get("BREVO_KEY") ?? "";
    const ADMIN = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",")[0]?.trim();
    if (!BREVO || !ADMIN) return false;
    try {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": BREVO, "Content-Type": "application/json" },
        body: JSON.stringify({ sender: { name: "TradeOptix Signals", email: "noreply@tradeoptix.app" }, to: [{ email: ADMIN }], subject, textContent: text }),
      });
      return r.ok;
    } catch { return false; }
  }
  async function whatsappAlert(sym: string, tf: string, sig: any, tier: number): Promise<void> {
    const d = sig.dir === 1 ? "🟢 LONG" : "🔴 SHORT";
    const msg = `⚡ TradeOptix Signal\n${d} ${sym} (${tf.toUpperCase()}${tier > 1 ? " T" + tier : ""})\nEntry: ${sig.entry.toFixed(6)}\nSL: ${sig.sl.toFixed(6)}\nTP: ${sig.tp3.toFixed(6)}\nSentiment: ${sent.score}/100 ${sent.label}`;
    const mailed = await sendAlertEmail(`⚡ SIGNAL: ${d} ${sym} (${tf.toUpperCase()})`, msg);
    if (mailed) await log("INFO", `Email alert sent — ${sym} ${tf}`);
    const TO = Deno.env.get("WHATSAPP_PHONE");
    if (!TO) return;
    try {
      const SID = Deno.env.get("TWILIO_SID"), TOK = Deno.env.get("TWILIO_TOKEN"), FROM = Deno.env.get("TWILIO_FROM");
      if (SID && TOK && FROM) {
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
          method: "POST",
          headers: { Authorization: `Basic ${btoa(`${SID}:${TOK}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ From: FROM, To: TO.startsWith("whatsapp:") ? TO : `whatsapp:${TO}`, Body: msg }).toString(),
        });
        return;
      }
      const WA_KEY = Deno.env.get("WHATSAPP_APIKEY");
      if (WA_KEY) await fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(TO)}&apikey=${WA_KEY}&text=${encodeURIComponent(msg)}`);
    } catch { /* whatsapp fail = ok, email already sent */ }
  }

  if (madeToday < quotaToday) {
    // PASS 1: 1D full confluence (T1) — parallel scan (8 at a time)
    await scanBatch(coins.filter((s2) => !doneToday.has(s2) && !pumpSet.has(s2)), async (sym) => {
      if (madeToday >= quotaToday) return null;
      try {
        const kl1d = await fetchKlines(sym, "1d");
        trendCache.set(sym, trend1d(kl1d));
        const sig = detect(kl1d, 1, strat);
        if (!sig) return null;
        if (!sentimentAllows(sentEff, sig.dir) || !regimeAllows(sent.regime, sig.dir)) { logs.push(`-- ${sym}: 1d setup but sentiment/regime blocks ${sig.dir === 1 ? "LONG" : "SHORT"}`); return null; }
        const recent = await runSql(`SELECT 1 FROM signals WHERE symbol='${esc(sym)}' AND timeframe='1d' AND signal_time >= now() - interval '24 hours' LIMIT 1`);
        if (recent.length > 0) return null;
        const aligned = (sentEff >= 55 && sig.dir === 1) || (sentEff <= 45 && sig.dir === -1);
        if (aligned) sig.score *= 1.15;
        await insert(sym, "1d", sig, 1, aligned);
        return { sym };
      } catch (e) { logs.push(`WARN ${sym} 1d: ${String(e)}`); return null; }
    });

    // PASS 2: quota fill — SINGLE PASS per coin: 4h klines cache, tier escalate 2→4, phir 1h fallback
    {
      const skips = new Set([...doneToday, ...made.map((m) => m.split(" ")[0]), ...pumpSet]);
      const maxTier = qualityOnly ? 2 : 4;
      const cands: { sym: string; sig: any; aligned: boolean; tf: string; tier: number }[] = [];
      const found = await scanBatch(coins.filter((s2) => !skips.has(s2)), async (sym) => {
        try {
          const kl4h = await fetchKlines(sym, "4h");
          let sig = null, tierUsed = 0, tf = "4h";
          for (let t = 2; t <= maxTier; t++) {
            sig = detect(kl4h, t, strat);
            if (sig) { tierUsed = t; break; }
          }
          if (!sig) {
            const kl1h = await fetchKlines(sym, "1h");
            for (let t = 3; t <= maxTier; t++) {
              sig = detect(kl1h, t, strat);
              if (sig) { tierUsed = t; tf = "1h"; break; }
            }
          }
          if (!sig) return null;
          const t1 = await t1d(sym);
          if (t1 !== sig.dir) { logs.push(`-- ${sym}: ${tf} ${sig.dir === 1 ? "LONG" : "SHORT"} but 1D trend mismatch (MTF block)`); return null; }
          if (!sentimentAllows(sentEff, sig.dir) || !regimeAllows(sent.regime, sig.dir)) return null;
          const aligned = (sentEff >= 55 && sig.dir === 1) || (sentEff <= 45 && sig.dir === -1);
          if (aligned) sig.score *= 1.15;
          return { sym, sig, aligned, tf, tier: tierUsed };
        } catch { return null; }
      });
      cands.push(...found);
      cands.sort((a, b) => b.sig.score - a.sig.score);
      for (const { sym, sig, aligned, tf, tier } of cands) {
        if (madeToday >= quotaToday) break;
        await insert(sym, tf, sig, tier, aligned);
      }
    }
  }

  if (pumpSet.size) await log("WARN", `🚨 Pump-filter: ${pumpSet.size} coins skipped (12%+ move — trap zone)`);
  const msg = `Engine run done in ${Date.now() - started}ms — sentiment ${sent.score} ${sent.label}, ${madeToday}/${quotaToday} today. New: ${made.join(", ") || "none"}`;
  await log("INFO", msg);
  return new Response(JSON.stringify({ sentiment: sent, quota: `${madeToday}/${quotaToday}`, new_signals: made, at: new Date().toISOString(), logs }, null, 2), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
