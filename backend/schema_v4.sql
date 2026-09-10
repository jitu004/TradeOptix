-- TradeOptix v4 — Schema Upgrade (Postgres / InsForge)
-- SQL Editor me paste karke RUN karo (purani tables safe rahengi)

-- 1) signals: true/false result tracking ke liye naye columns
ALTER TABLE signals ADD COLUMN IF NOT EXISTS result BOOLEAN;          -- true=TP_HIT, false=SL_HIT/EXPIRED-loss
ALTER TABLE signals ADD COLUMN IF NOT EXISTS exit_price DOUBLE PRECISION;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS pnl_pct DOUBLE PRECISION;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS tier SMALLINT DEFAULT 1; -- 1=full confluence, 2..4=relaxed (quota fill)

CREATE INDEX IF NOT EXISTS idx_signals_time ON signals(signal_time DESC);

-- 2) Engine logs — realtime log capture
CREATE TABLE IF NOT EXISTS engine_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    level TEXT NOT NULL DEFAULT 'INFO',     -- INFO / SIGNAL / TRUE / FALSE / WARN / ERROR
    message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engine_logs_ts ON engine_logs(ts DESC);

-- 3) Server backtest results — sirf backend par compute hone wala backtest yahan save hota hai
CREATE TABLE IF NOT EXISTS backtest_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL,
    stats JSONB NOT NULL,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bt_runs ON backtest_runs(ran_at DESC);

-- 3b) Market sentiment (sentiment engine har 15 min me refresh karta hai)
CREATE TABLE IF NOT EXISTS sentiment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    score SMALLINT NOT NULL,                -- 0-100
    label TEXT NOT NULL,                    -- EXTREME FEAR / FEAR / NEUTRAL / GREED / EXTREME GREED
    components JSONB
);
CREATE INDEX IF NOT EXISTS idx_sentiment_ts ON sentiment(ts DESC);

-- 4) RLS — sab read kar sakte hain, write sirf service key se
ALTER TABLE engine_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentiment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read engine_logs" ON engine_logs FOR SELECT USING (true);
CREATE POLICY "public read backtest_runs" ON backtest_runs FOR SELECT USING (true);
CREATE POLICY "public read sentiment" ON sentiment FOR SELECT USING (true);
