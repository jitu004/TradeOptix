// TradeOptix — Market Sentiment Engine v4.1 — InsForge Edge Function (Deno/TS)
// Har 15 min chalao (cron "*/15 * * * *") — public bhi rakh sakte ho (frontend panel ke liye)
// 5 components se composite 0-100 score (sab Binance public data, no API key):
//   1. BTC momentum      — 24h change mapped
//   2. BTC trend          — price vs EMA50 (4h)
//   3. Market breadth     — top-50 USDT pairs me % jo EMA20 (4h) ke upar hain
//   4. Funding sentiment  — BTC+ETH perp funding rate (greed = positive, fear = negative)
//   5. Volatility regime  — ATR% calm → confidence, panic → fear
// Result `sentiment` table me save hota hai — signal_engine isi ko quality gate ke liye padhta hai.

const BINANCE = "https://data-api.binance.vision/api/v3";
const FAPI = "https://fapi.binance.com/fapi/v1";
const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";

function esc(v: string): string { return v.replace(/'/g, "''"); }
const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

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

function ema(v: number[], n: number): number[] {
  const k = 2 / (n + 1); const o: number[] = []; let e = v[0];
  for (let i = 0; i < v.length; i++) { e = i === 0 ? v[i] : v[i] * k + e * (1 - k); o.push(e); }
  return o;
}

async function fetchKlines(sym: string, tf: string, limit: number): Promise<any[]> {
  const r = await fetch(`${BINANCE}/klines?symbol=${sym}&interval=${tf}&limit=${limit}`);
  const raw = await r.json();
  return raw.map((x: any[]) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }));
}

export default async function handler(_req: Request): Promise<Response> {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" };
  try {
    // 1) BTC momentum from 24h ticker
    const tickers = await (await fetch(`${BINANCE}/ticker/24hr`)).json();
    const btc = tickers.find((t: any) => t.symbol === "BTCUSDT");
    const chg24 = +btc.priceChangePercent;
    const momentum = clamp(50 + chg24 * 5);                 // -10% → 0, +10% → 100

    // 2) BTC trend: price vs EMA50 on 4h
    const kl4h = await fetchKlines("BTCUSDT", "4h", 100);
    const closes = kl4h.map((k: any) => k.c);
    const e50 = ema(closes, 50);
    const dist = (closes[closes.length - 1] - e50[e50.length - 1]) / e50[e50.length - 1] * 100;
    const trend = clamp(50 + dist * 20);                    // ±2.5% around EMA50

    // 3) Breadth: top-50 USDT pairs, % above EMA20 on 4h
    const top50 = tickers
      .filter((t: any) => t.symbol.endsWith("USDT") && !/(UP|DOWN|BULL|BEAR)/.test(t.symbol) && +t.lastPrice > 0)
      .sort((a: any, b: any) => +b.quoteVolume - +a.quoteVolume)
      .slice(0, 50).map((t: any) => t.symbol);
    let above = 0, checked = 0;
    for (const sym of top50.slice(0, 25)) {                 // 25 sample — fast enough
      try {
        const kl = await fetchKlines(sym, "4h", 60);
        const c = kl.map((x: any) => x.c);
        const e = ema(c, 20);
        if (c[c.length - 1] > e[e.length - 1]) above++;
        checked++;
      } catch { /* skip */ }
    }
    const breadth = checked ? (above / checked) * 100 : 50;

    // 4) Funding sentiment (BTC + ETH perp) — fail ho toh neutral
    let funding = 50;
    try {
      const fr = await (await fetch(`${FAPI}/premiumIndex?symbols=["BTCUSDT","ETHUSDT"]`)).json();
      const avg = fr.reduce((s: number, x: any) => s + +x.lastFundingRate, 0) / fr.length;
      funding = clamp(50 + avg * 10000);                    // +0.005 → 100, -0.005 → 0
    } catch { /* neutral */ }

    // 5) Volatility regime: BTC daily ATR%
    const kld = await fetchKlines("BTCUSDT", "1d", 60);
    let atrSum = 0;
    for (let i = 1; i < kld.length; i++) {
      atrSum += Math.max(kld[i].h - kld[i].l, Math.abs(kld[i].h - kld[i - 1].c), Math.abs(kld[i].l - kld[i - 1].c));
    }
    const atrPct = (atrSum / kld.length) / kld[kld.length - 1].c * 100;
    const volatility = clamp(100 - (atrPct - 1) * 40);      // 1% ATR → 100, 3.5%+ → 0

    // 6) Open Interest (BTC perp) — rising OI = leverage buildup
    let open_interest = 50;
    try {
      const oi = await (await fetch(`${FAPI}/openInterestHist?symbol=BTCUSDT&period=5m&limit=200`)).json();
      if (Array.isArray(oi) && oi.length > 20) {
        const cur = +oi[oi.length - 1].sumOpenInterest;
        const avg = oi.slice(-100).reduce((x: number, y: any) => x + +y.sumOpenInterest, 0) / 100;
        open_interest = clamp(50 + ((cur - avg) / avg) * 300);
      }
    } catch { /* neutral */ }

    // 7) Market regime — BTC 1D vs EMA50/EMA200 + 30d return
    let regime = "RANGE";
    try {
      const kd = await fetchKlines("BTCUSDT", "1d", 260);
      const cd = kd.map((k: any) => k.c);
      const e50 = ema(cd, 50), e200 = ema(cd, 200);
      const last = cd[cd.length - 1];
      const ret30 = ((last - cd[cd.length - 30]) / cd[cd.length - 30]) * 100;
      if (last > e50[e50.length - 1] && e50[e50.length - 1] > e200[e200.length - 1] && ret30 > 5) regime = "BULL";
      else if (last < e50[e50.length - 1] && e50[e50.length - 1] < e200[e200.length - 1] && ret30 < -5) regime = "BEAR";
    } catch { /* RANGE */ }

    const score = Math.round(momentum * 0.22 + trend * 0.22 + breadth * 0.22 + funding * 0.12 + volatility * 0.10 + open_interest * 0.12);
    const bias = regime === "BEAR" ? "BEAR regime — LONGs restricted" : regime === "BULL" ? "BULL regime — SHORTs restricted" : score >= 55 ? "LONG bias" : score <= 45 ? "SHORT bias" : "no bias — range market";
    const label = score >= 75 ? "EXTREME GREED" : score >= 55 ? "GREED" : score > 45 ? "NEUTRAL" : score > 25 ? "FEAR" : "EXTREME FEAR";
    const bias = score >= 55 ? "LONG bias" : score <= 45 ? "SHORT bias" : "no bias — range market";

    const payload = {
      score, label, bias, at: new Date().toISOString(),
      regime,
      components: {
        btc_momentum_24h: +momentum.toFixed(1),
        btc_trend_4h: +trend.toFixed(1),
        market_breadth: +breadth.toFixed(1),
        funding_sentiment: +funding.toFixed(1),
        volatility_regime: +volatility.toFixed(1),
        open_interest: +open_interest.toFixed(1),
      },
    };

    await runSql(`INSERT INTO sentiment (score,label,components) VALUES (${score},'${esc(label)}','${esc(JSON.stringify(payload.components))}'::jsonb)`);
    await runSql(`INSERT INTO engine_logs (level,message) VALUES ('INFO','Sentiment ${score}/100 ${label} — ${bias}')`);
    return new Response(JSON.stringify(payload, null, 2), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors });
  }
}
