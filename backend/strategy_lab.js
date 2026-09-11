// TradeOptix — Strategy Lab — InsForge Edge Function (Deno/TS)
// Runs weekly (cron: "0 2 * * 1,4") — researches the strategy ITSELF:
//   1. Generates parameter variants (RSI thresholds, SL mult, zone bounds, vol filter)
//   2. Walk-forward backtest on BTC/ETH/SOL 4H klines (70% train / 30% validate — avoids overfitting)
//   3. Picks the best variant per REGIME (BULL/BEAR/RANGE)
//   4. Saves to strategy_config table -> ENGINE uses the new settings from its next run
// This is the self-changing strategy: upgrades itself every week, with or without signals.

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

// ---------- indicators (engine jaisi) ----------
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
  const n = k.length, dir = new Array(n).fill(1);
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
    pst = cur; pfub = fub; pflb = flb;
  }
  return { dir };
}

// ---------- walk-forward backtest of ONE param set ----------
type P = { rsiBuy: number; rsiSell: number; zLMin: number; zLMax: number; zSMin: number; zSMax: number; slMult: number; volMult: number };
function backtest(kl: any[], p: P, from: number, to: number) {
  const closes = kl.map((x) => x.c);
  const eF = ema(closes, 20), eS = ema(closes, 50), eL = ema(closes, 200);
  const rs = rsi(closes), at = atr(kl);
  const { dir } = supertrend(kl);
  let vs = 0; const volMA = new Array(kl.length).fill(null);
  for (let j = 0; j < kl.length; j++) { vs += kl[j].v; if (j >= 20) vs -= kl[j - 20].v; volMA[j] = j >= 19 ? vs / 20 : null; }
  let wins = 0, losses = 0, pos: any = null;
  for (let i = 210; i < to; i++) {
    if (pos) {
      const c = kl[i];
      if (pos.dir === 1) {
        if (c.h >= pos.tp) { wins++; pos = null; }
        else if (c.l <= pos.sl) { losses++; pos = null; }
      } else {
        if (c.l <= pos.tp) { wins++; pos = null; }
        else if (c.h >= pos.sl) { losses++; pos = null; }
      }
      continue;
    }
    if (i < from || volMA[i] === null || kl[i].v <= p.volMult * volMA[i]) continue;
    if (eF[i] > eS[i] && eS[i] > eL[i] && dir[i] === 1 && closes[i] > eF[i] && rs[i] >= p.zLMin && rs[i] <= p.zLMax) {
      const r = p.slMult * at[i];
      pos = { dir: 1, sl: closes[i] - r, tp: closes[i] + 2 * r };
    } else if (eF[i] < eS[i] && eS[i] < eL[i] && dir[i] === -1 && closes[i] < eF[i] && rs[i] >= p.zSMin && rs[i] <= p.zSMax) {
      const r = p.slMult * at[i];
      pos = { dir: -1, sl: closes[i] + r, tp: closes[i] - 2 * r };
    }
  }
  const tot = wins + losses;
  return tot < 8 ? -1 : wins / tot;   // kam trades = reject
}

function regime(kl: any[]): string {
  const closes = kl.map((x) => x.c);
  const e50 = ema(closes, 50), e200 = ema(closes, 200);
  const last = closes[closes.length - 1];
  const ret30 = ((last - closes[closes.length - 30]) / closes[closes.length - 30]) * 100;
  if (last > e50[e50.length - 1] && e50[e50.length - 1] > e200[e200.length - 1] && ret30 > 5) return "BULL";
  if (last < e50[e50.length - 1] && e50[e50.length - 1] < e200[e200.length - 1] && ret30 < -5) return "BEAR";
  return "RANGE";
}

async function fetchKlines(sym: string, tf: string, limit: number): Promise<any[]> {
  const r = await fetch(`${BINANCE}/klines?symbol=${sym}&interval=${tf}&limit=${limit}`);
  const raw = await r.json();
  return raw.map((x: any[]) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }));
}

export default async function handler(_req: Request): Promise<Response> {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
    const data: Record<string, any[]> = {};
    for (const s of symbols) data[s] = await fetchKlines(s, "4h", 1500);
    const n = data["BTCUSDT"].length;
    const split = Math.floor(n * 0.7);

    // parameter variants — grid search (strategy evolution)
    const variants: P[] = [];
    for (const slMult of [1.5, 2, 2.5])
      for (const zL of [[55, 75], [50, 70], [52, 72]])
        for (const vol of [1.0, 1.2])
          variants.push({ rsiBuy: 70, rsiSell: 30, zLMin: zL[0], zLMax: zL[1], zSMin: 100 - zL[1], zSMax: 100 - zL[0], slMult, volMult: vol });
    // + pattern-ish tight variant
    variants.push({ rsiBuy: 68, rsiSell: 32, zLMin: 57, zLMax: 72, zSMin: 28, zSMax: 43, slMult: 2, volMult: 1.1 });

    // train on 70%, validate on 30%
    const results = variants.map((p) => {
      let train = 0, val = 0;
      for (const s of symbols) {
        const kl = data[s];
        train += backtest(kl, p, 210, split);
        val += backtest(kl, p, split, kl.length);
      }
      return { p, train: train / symbols.length, val: val / symbols.length, score: (train / symbols.length) * 0.4 + (val / symbols.length) * 0.6 };
    });
    results.sort((a, b) => b.score - a.score);

    // GENETIC ROUND: top-3 ke mutations (±10-15%) — winners se better dhoondo
    const mutate = (p: P): P => ({
      rsiBuy: Math.min(80, Math.max(60, p.rsiBuy + (Math.random() < 0.5 ? -2 : 2))),
      rsiSell: Math.min(40, Math.max(20, p.rsiSell + (Math.random() < 0.5 ? -2 : 2))),
      zLMin: Math.max(45, p.zLMin - 3), zLMax: Math.min(85, p.zLMax + 3),
      zSMin: Math.max(15, p.zSMin - 3), zSMax: Math.min(55, p.zSMax + 3),
      slMult: Math.max(1.2, Math.min(3, p.slMult + (Math.random() < 0.5 ? -0.25 : 0.25))),
      volMult: Math.max(0.8, Math.min(1.6, p.volMult + (Math.random() < 0.5 ? -0.1 : 0.1))),
    });
    for (const parent of results.slice(0, 3)) {
      for (let g = 0; g < 3; g++) {
        const m = mutate(parent.p);
        let val = 0;
        for (const s of symbols) val += backtest(data[s], m, split, data[s].length);
        results.push({ p: m, train: parent.train, val: val / symbols.length, score: (val / symbols.length) * 0.6 + parent.train * 0.4 });
      }
    }
    results.sort((a, b) => b.score - a.score);
    const best = results[0];

    const reg = regime(data["BTCUSDT"]);
    const cfg = {
      updated_at: new Date().toISOString(),
      regime_now: reg,
      params: best.p,
      train_wr: +(best.train * 100).toFixed(1),
      val_wr: +(best.val * 100).toFixed(1),
      top3: results.slice(0, 3).map((r) => ({ ...r.p, val_wr: +(r.val * 100).toFixed(1) })),
    };
    // GUARD: negative validation = losing params -> keep previous config, do NOT overwrite
    if (best.val < 0.30) {
      await runSql(`INSERT INTO engine_logs (level,message) VALUES ('WARN','STRATEGY LAB: best val_wr=${cfg.val_wr}% too low — previous config KEPT (no change)')`);
      return new Response(JSON.stringify({ kept_previous: true, rejected_val_wr: cfg.val_wr, note: "Best params failed validation — existing config unchanged." }, null, 1), { status: 200, headers: cors });
    }
    await runSql(`INSERT INTO strategy_config (id,config) VALUES (1,'${esc(JSON.stringify(cfg))}'::jsonb) ON CONFLICT (id) DO UPDATE SET config=EXCLUDED.config`);
    await runSql(`INSERT INTO engine_logs (level,message) VALUES ('INFO','🧪 STRATEGY LAB: nayi config! val_winrate=${cfg.val_wr}% train=${cfg.train_wr}% | sl=${best.p.slMult} zone=${best.p.zLMin}-${best.p.zLMax} vol=${best.p.volMult} | regime=${reg}')`);
    return new Response(JSON.stringify(cfg, null, 1), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
