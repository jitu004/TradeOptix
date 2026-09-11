-- TradeOptix v4 -- Schema Upgrade (Postgres / InsForge)
-- InsForge Dashboard -> SQL Editor -> paste -> Run
-- NOTE: edge functions use the service key for DB access

-- 1) signals: new columns for true/false result tracking
ALTER TABLE signals ADD COLUMN IF NOT EXISTS result BOOLEAN;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS exit_price DOUBLE PRECISION;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS pnl_pct DOUBLE PRECISION;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS tier SMALLINT DEFAULT 1;

-- 2) engine_logs: realtime log capture
CREATE TABLE IF NOT EXISTS engine_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    level TEXT NOT NULL DEFAULT 'INFO',
    message TEXT NOT NULL
);

-- 3) backtest_runs: server-side backtest results
CREATE TABLE IF NOT EXISTS backtest_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL,
    stats JSONB NOT NULL,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4) sentiment: market sentiment score (refreshed every 15 min)
CREATE TABLE IF NOT EXISTS sentiment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    score SMALLINT NOT NULL,
    label TEXT NOT NULL,
    components JSONB
);
