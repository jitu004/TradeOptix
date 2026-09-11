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
const TOP_N = 25;
const QUOTA_PER_DAY = 10;
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

async function log(level: string, message: string): Promise<void> {
  try { await runSql(`INSERT INTO engine_logs (level,message) VALUES ('${esc(level)}','${esc(message)}')`); } catch (e) { console.error("log fail:", String(e)); }
}

// ---------- sentiment gate ----------
async function getSentiment(): Promise<{ score: number; label: string }> {
  try {
    const rows = await runSql(`SELECT score,label FROM sentiment ORDER BY ts DESC LIMIT 1`);
    if (rows.length) return { score: rows[0].score, label: rows[0].label };
  } catch { /* table missing → neutral */ }
  return { score: 50, label: "NEUTRAL" };
}

function sentimentAllows(score: number, dir: 1 | -1): boolean {
  if (score >= 75) return dir === -1;   // extreme greed — sirf SHORT (fade)
  if (score <= 25) return dir === 1;    // extreme fear — sirf LONG (dip buy)
  if (score >= 55) return dir === 1;    // greed — LONG
  if (score <= 45) return dir === -1;   // fear — SHORT
  return true;                          // neutral
}

// ---------- coin universe ----------
async function topCoins(): Promise<string[]> {
  const r = await fetch(`${BINANCE}/ticker/24hr`);
  const all = await r.json();
  return all
    .filter((t: any) => t.symbol.endsWith("USDT") && !/(UP|DOWN|BULL|BEAR)/.test(t.symbol) && +t.lastPrice > 0)
    .sort((a: any, b: any) => +b.quoteVolume - +a.quoteVolume)
    .slice(0, TOP_N)
    .map((t: any) => t.symbol);
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
  const r = await fetch(`${BINANCE}/klines?symbol=${sym}&interval=${tf}&limit=400`);
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

// ---------- tiered detection ----------
// Tier 1-3: RSI CROSS based (quality events, strict)
// Tier 4:   RSI ZONE based (state-based — quota fill ke liye, zyada frequent)
function detect(kl: any[], tier: number) {
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
  if (volMA[i] === null) return null;
  const volOK = tier >= 2 || kl[i].v > 1.2 * volMA[i];
  const stOK = tier >= 4 || (st[i] !== null && dir[i] === 1);
  const stOKS = tier >= 4 || (st[i] !== null && dir[i] === -1);

  // ---- Tier 4: state-based (RSI zone, no cross needed) — frequent setups for quota ----
  if (tier >= 4) {
    if (eF[i] > eS[i] && eS[i] > eL[i] && closes[i] > eF[i] && rs[i] >= 55 && rs[i] <= 75) {
      const r = SL_ATR * at[i];
      return { dir: 1 as const, entry, sl: entry - r, tp1: entry + r, tp2: entry + 2 * r, tp3: entry + 3 * r, atr: at[i], score: kl[i].v / (volMA[i] || 1) };
    }
    if (eF[i] < eS[i] && eS[i] < eL[i] && closes[i] < eF[i] && rs[i] <= 45 && rs[i] >= 25) {
      const r = SL_ATR * at[i];
      return { dir: -1 as const, entry, sl: entry + r, tp1: entry - r, tp2: entry - 2 * r, tp3: entry - 3 * r, atr: at[i], score: kl[i].v / (volMA[i] || 1) };
    }
    return null;
  }

  // ---- Tier 1-3: cross-based ----
  if (eF[i] > eS[i] && eS[i] > eL[i] && stOK && (tier >= 3 || (v !== null && closes[i] > v))
    && rs[i - 1] < RSI_BUY && rs[i] >= RSI_BUY && closes[i] > eF[i] && volOK) {
    const r = SL_ATR * at[i];
    return { dir: 1 as const, entry, sl: entry - r, tp1: entry + r, tp2: entry + 2 * r, tp3: entry + 3 * r, atr: at[i], score: kl[i].v / (volMA[i] || 1) };
  }
  if (eF[i] < eS[i] && eS[i] < eL[i] && stOKS && (tier >= 3 || (v !== null && closes[i] < v))
    && rs[i - 1] > RSI_SELL && rs[i] <= RSI_SELL && closes[i] < eF[i] && volOK) {
    const r = SL_ATR * at[i];
    return { dir: -1 as const, entry, sl: entry + r, tp1: entry - r, tp2: entry - 2 * r, tp3: entry - 3 * r, atr: at[i], score: kl[i].v / (volMA[i] || 1) };
  }
  return null;
}

// ---------- main ----------
export default async function handler(_req: Request, _ctx: unknown): Promise<Response> {
  const started = Date.now();
  let coins: string[] = [];
  try { coins = await topCoins(); }
  catch (e) { await log("ERROR", "topCoins failed: " + String(e)); return new Response(JSON.stringify({ error: String(e) }), { status: 502 }); }

  const sent = await getSentiment();
  let madeToday = (await runSql(`SELECT count(*)::int AS c FROM signals WHERE signal_time >= now()::date`))[0]?.c ?? 0;
  const logs: string[] = [`sentiment ${sent.score}/100 ${sent.label} — quota ${madeToday}/${QUOTA_PER_DAY}`];
  await log("INFO", `Engine run — sentiment ${sent.score}/100 (${sent.label}), quota ${madeToday}/${QUOTA_PER_DAY}`);

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
    await runSql(`INSERT INTO signals (symbol,timeframe,direction,entry_price,stop_loss,take_profit,atr,rr_ratio,status,tier) VALUES ('${esc(sym)}','${tf}',${sig.dir},${sig.entry},${sig.sl},${sig.tp3},${sig.atr},${RR},'ACTIVE',${tier})`);
    madeToday++;
    made.push(`${sym} ${tf} T${tier}`);
    const tag = sentAligned ? "sentiment-aligned ⭐" : tier === 1 ? "full confluence" : `tier ${tier} relaxed`;
    logs.push(`OK ${sym} ${tf} T${tier} ${sig.dir === 1 ? "LONG" : "SHORT"}`);
    await log("SIGNAL", `${sym} ${tf.toUpperCase()} ${sig.dir === 1 ? "LONG" : "SHORT"} @ ${sig.entry.toFixed(4)} (${tag}, quota ${madeToday}/${QUOTA_PER_DAY})`);
    await whatsappAlert(sym, tf, sig, tier);
  }

  // --- mobile alert (WhatsApp via CallMeBot — free) ---
  async function whatsappAlert(sym: string, tf: string, sig: any, tier: number): Promise<void> {
    const WA_PHONE = Deno.env.get("WHATSAPP_PHONE");     // e.g. +919876543210
    const WA_KEY = Deno.env.get("WHATSAPP_APIKEY");      // CallMeBot apikey
    if (!WA_PHONE || !WA_KEY) return;                    // env vars nahi hain toh silently skip
    const d = sig.dir === 1 ? "🟢 LONG" : "🔴 SHORT";
    const msg = `⚡ TradeOptix Signal\n${d} ${sym} (${tf.toUpperCase()}${tier > 1 ? " T" + tier : ""})\nEntry: ${sig.entry.toFixed(6)}\nSL: ${sig.sl.toFixed(6)}\nTP: ${sig.tp3.toFixed(6)}\nSentiment: ${sent.score}/100 ${sent.label}`;
    try {
      await fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(WA_PHONE)}&apikey=${WA_KEY}&text=${encodeURIComponent(msg)}`);
      await log("INFO", `WhatsApp alert sent — ${sym} ${tf}`);
    } catch (e) {
      await log("WARN", `WhatsApp alert failed: ${String(e)}`);
    }
  }

  if (madeToday < QUOTA_PER_DAY) {
    // PASS 1: 1D full confluence (T1) — MTF: 1D signal apne hi trend ke saath hota hai, sentiment gate applies
    for (const sym of coins) {
      if (madeToday >= QUOTA_PER_DAY) break;
      if (doneToday.has(sym)) continue;
      try {
        const kl1d = await fetchKlines(sym, "1d");
        trendCache.set(sym, trend1d(kl1d));
        const sig = detect(kl1d, 1);
        if (!sig) continue;
        if (!sentimentAllows(sent.score, sig.dir)) { logs.push(`-- ${sym}: 1d setup but sentiment blocks ${sig.dir === 1 ? "LONG" : "SHORT"}`); continue; }
        const recent = await runSql(`SELECT 1 FROM signals WHERE symbol='${esc(sym)}' AND timeframe='1d' AND signal_time >= now() - interval '24 hours' LIMIT 1`);
        if (recent.length > 0) continue;
        const aligned = (sent.score >= 55 && sig.dir === 1) || (sent.score <= 45 && sig.dir === -1);
        if (aligned) sig.score *= 1.15;
        await insert(sym, "1d", sig, 1, aligned);
      } catch (e) { logs.push(`WARN ${sym} 1d: ${String(e)}`); }
    }

    // PASS 2: quota fill — 4H setup + 1D trend alignment (MTF) + sentiment gate, tiered relax T2→T4
    for (let tier = 2; tier <= 4 && madeToday < QUOTA_PER_DAY; tier++) {
      const cands: { sym: string; sig: any; aligned: boolean }[] = [];
      for (const sym of coins) {
        if (doneToday.has(sym) || made.some((m) => m.startsWith(sym))) continue;
        try {
          const sig = detect(await fetchKlines(sym, "4h"), tier);
          if (!sig) continue;
          const t1 = await t1d(sym);
          if (t1 !== sig.dir) { logs.push(`-- ${sym}: 4h ${sig.dir === 1 ? "LONG" : "SHORT"} but 1D trend mismatch (MTF block)`); continue; }
          if (!sentimentAllows(sent.score, sig.dir)) continue;
          const aligned = (sent.score >= 55 && sig.dir === 1) || (sent.score <= 45 && sig.dir === -1);
          if (aligned) sig.score *= 1.15;
          cands.push({ sym, sig, aligned });
        } catch { /* skip */ }
      }
      cands.sort((a, b) => b.sig.score - a.sig.score);
      for (const { sym, sig, aligned } of cands) {
        if (madeToday >= QUOTA_PER_DAY) break;
        await insert(sym, "4h", sig, tier, aligned);
      }
    }
  }

  const msg = `Engine run done in ${Date.now() - started}ms — sentiment ${sent.score} ${sent.label}, ${madeToday}/${QUOTA_PER_DAY} today. New: ${made.join(", ") || "none"}`;
  await log("INFO", msg);
  return new Response(JSON.stringify({ sentiment: sent, quota: `${madeToday}/${QUOTA_PER_DAY}`, new_signals: made, at: new Date().toISOString(), logs }, null, 2), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
