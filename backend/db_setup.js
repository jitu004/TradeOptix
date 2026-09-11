// TradeOptix — DB Setup (one-time) — InsForge Edge Function (Deno/TS)
// The SQL Editor rejects DDL scripts, so this function uses the service key to
// create all tables/columns itself.
// USE: deploy this function (with env vars), then open in browser:
//   https://r3pjdfkc.function2.insforge.app/db_setup
// Result shows each statement's status. Run once, then you may delete the function.

const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";

const STATEMENTS: string[] = [
  // base signals table (v3 + v4 columns combined) — safe re-run
  `CREATE TABLE IF NOT EXISTS signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL DEFAULT '1d',
    direction SMALLINT NOT NULL,
    entry_price DOUBLE PRECISION NOT NULL,
    stop_loss DOUBLE PRECISION NOT NULL,
    take_profit DOUBLE PRECISION NOT NULL,
    atr DOUBLE PRECISION,
    rr_ratio DOUBLE PRECISION,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    result BOOLEAN,
    exit_price DOUBLE PRECISION,
    pnl_pct DOUBLE PRECISION,
    resolved_at TIMESTAMPTZ,
    tier SMALLINT DEFAULT 1,
    signal_time TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  // v4 columns (no-op if they already exist)
  `ALTER TABLE signals ADD COLUMN IF NOT EXISTS result BOOLEAN`,
  `ALTER TABLE signals ADD COLUMN IF NOT EXISTS exit_price DOUBLE PRECISION`,
  `ALTER TABLE signals ADD COLUMN IF NOT EXISTS pnl_pct DOUBLE PRECISION`,
  `ALTER TABLE signals ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`,
  `ALTER TABLE signals ADD COLUMN IF NOT EXISTS tier SMALLINT DEFAULT 1`,

  `ALTER TABLE signals ADD COLUMN IF NOT EXISTS pattern TEXT`,
  `ALTER TABLE signals ADD COLUMN IF NOT EXISTS tp_hit SMALLINT DEFAULT 0`,
  `ALTER TABLE signals ADD COLUMN IF NOT EXISTS sl_current DOUBLE PRECISION`,

  // realtime log capture
  `CREATE TABLE IF NOT EXISTS engine_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    level TEXT NOT NULL DEFAULT 'INFO',
    message TEXT NOT NULL
  )`,

  // server-side backtest results
  `CREATE TABLE IF NOT EXISTS backtest_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL,
    stats JSONB NOT NULL,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  // market sentiment
  `CREATE TABLE IF NOT EXISTS sentiment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    score SMALLINT NOT NULL,
    label TEXT NOT NULL,
    components JSONB
  )`,

  // login activity tracking
  `CREATE TABLE IF NOT EXISTS logins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    email TEXT NOT NULL,
    uid TEXT,
    ua TEXT
  )`,

  // access requests (signup -> admin approval flow)
  `CREATE TABLE IF NOT EXISTS strategy_config (
    id INTEGER PRIMARY KEY,
    config JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS news_score (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    score SMALLINT NOT NULL DEFAULT 0,
    headline TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    uid TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at TIMESTAMPTZ,
    approved_by TEXT
  )`,
  // cleanup: ACTIVE duplicates — keep lowest tier per symbol, then oldest
  `DELETE FROM signals a USING signals b WHERE a.status='ACTIVE' AND b.status='ACTIVE' AND a.symbol=b.symbol AND a.id<>b.id AND a.tier > b.tier`,
  `DELETE FROM signals a USING signals b WHERE a.status='ACTIVE' AND b.status='ACTIVE' AND a.symbol=b.symbol AND a.tier=b.tier AND a.id > b.id AND a.id<>b.id`
];

async function runOne(sql: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${BASE}/api/database/advance/rawsql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ query: sql }),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export default async function handler(_req: Request): Promise<Response> {
  if (!KEY) {
    return new Response(JSON.stringify({ error: "INSFORGE_SERVICE_KEY env var missing" }), { status: 500 });
  }
  const results: { statement: string; ok: boolean; error?: string }[] = [];
  for (const sql of STATEMENTS) {
    const head = sql.split("\n")[0].slice(0, 60);
    const res = await runOne(sql);
    results.push({ statement: head, ...res });
  }
  const failed = results.filter((r) => !r.ok);
  return new Response(
    JSON.stringify({
      done: true,
      total: results.length,
      failed: failed.length,
      results,
      note: "ALTER duplicate-column errors are safe to ignore (IF NOT EXISTS covers them).",
    }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
}
