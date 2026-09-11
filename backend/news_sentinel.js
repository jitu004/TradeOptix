// TradeOptix — News Sentinel — InsForge Edge Function (Deno/TS)
// Run hourly (cron "0 * * * *") — scans free RSS feeds for crypto headlines.
// FUD/FOMO keywords -> event-risk score (-5..+5). Engine switches to quality-only mode on major events.

const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";

const FUD = ["hack", "hacked", "exploit", "ban", "banned", "lawsuit", "sec charges", "crackdown", "crash", "dump", "collapse", "liquidation cascade", "fraud", "insolvency", "delist"];
const FOMO = ["etf approved", "etf approval", "partnership", "all-time high", "ath", "surge", "rally", "record inflow", "adoption", "elon", "musk", "tesla buys", "institutional", "rate cut"];

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

async function fetchRss(url: string): Promise<string[]> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const xml = await r.text();
    const titles = [...xml.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\])?<\/title>/g)].map((m) => m[1]).slice(1, 12);
    return titles;
  } catch { return []; }
}

export default async function handler(_req: Request): Promise<Response> {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const headlines = [
      ...(await fetchRss("https://cointelegraph.com/rss")),
      ...(await fetchRss("https://www.coindesk.com/arc/outboundfeeds/rss/")),
    ];
    let score = 0, top = "";
    for (const h of headlines) {
      const t = h.toLowerCase();
      for (const k of FUD) if (t.includes(k)) { score -= 1; if (!top) top = h.slice(0, 140); }
      for (const k of FOMO) if (t.includes(k)) { score += 1; if (!top) top = h.slice(0, 140); }
    }
    score = Math.max(-5, Math.min(5, score));
    await runSql(`INSERT INTO news_score (score,headline) VALUES (${score},'${esc(top || "quiet")}')`);
    if (Math.abs(score) >= 3) {
      await runSql(`INSERT INTO engine_logs (level,message) VALUES ('WARN','📰 NEWS EVENT score=${score}: ${esc(top.slice(0, 100))}')`);
    }
    return new Response(JSON.stringify({ headlines: headlines.length, score, top }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
