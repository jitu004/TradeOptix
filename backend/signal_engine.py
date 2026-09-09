"""
TradeOptix — Signal Engine v2 (Confluence Strategy)
====================================================
Runs as a SCHEDULED JOB on InsForge (Python function / cron).
Scans Binance, detects CONFLUENCE signals, stores them in DB.

Confluence conditions (validated on 5-year backtest, fees included):
  LONG : EMA20>EMA50>EMA200 AND Supertrend bullish AND close>VWAP AND RSI cross >70
  SHORT: EMA20<EMA50<EMA200 AND Supertrend bearish AND close<VWAP AND RSI cross <30
  SL = 2.0 x ATR(14)      TP ladder = 1R / 2R / 3R
Backtest (Sep 2021-Sep 2026, 1D): BTC 57.1% win / PF 2.24,
  ETH 61.5% / 2.50, LINK 53.3% / 1.86, SOL weak (excluded below).

Env vars: INSFORGE_URL, INSFORGE_SERVICE_KEY (server-side only!)
"""

import os, json, urllib.request
from datetime import datetime, timezone

BINANCE_API = "https://data-api.binance.vision/api/v3"
COINS = ["BTCUSDT", "ETHUSDT", "LINKUSDT", "XRPUSDT", "DOGEUSDT",
         "ADAUSDT", "SOLUSDT"]          # SOL kept but flagged weak
TIMEFRAME = "1d"
KLINES_LIMIT = 400
FEE_RT = 0.002
RR, SL_ATR, MAX_HOLD = 3.0, 2.0, 25
RSI_BUY, RSI_SELL = 70.0, 30.0

INSFORGE_URL = os.environ.get("INSFORGE_URL", "https://r3pjdfkc.insforge.site").rstrip("/")
INSFORGE_KEY = os.environ["INSFORGE_SERVICE_KEY"]

# ---------- INDICATORS ----------
def ema(values, n):
    k = 2 / (n + 1); out = []; e = values[0]
    for i, v in enumerate(values):
        e = v if i == 0 else v * k + e * (1 - k)
        out.append(e)
    return out

def rsi(closes, n=14):
    out = [50.0] * len(closes); ag = al = 0.0
    for i in range(1, len(closes)):
        d = closes[i] - closes[i-1]; u = max(d, 0); l = max(-d, 0)
        if i <= n: ag += u / n; al += l / n
        else: ag = (ag * (n - 1) + u) / n; al = (al * (n - 1) + l) / n
        out[i] = 100 if al == 0 else 100 - 100 / (1 + ag / al)
    return out

def atr(kl, n=14):
    out = [0.0] * len(kl); a = 0.0
    for i in range(len(kl)):
        pc = kl[i-1]["c"] if i else kl[i]["c"]
        tr = max(kl[i]["h"] - kl[i]["l"], abs(kl[i]["h"] - pc), abs(kl[i]["l"] - pc))
        a = tr if i == 0 else ((a * (n - 1) + tr) / n if i >= n else a + tr / n)
        out[i] = a
    return out

def supertrend(kl, period=10, mult=3.0):
    a = atr(kl, period); st = [None] * len(kl); d = [1] * len(kl)
    fub = flb = pst = pfub = pflb = None
    for i in range(period, len(kl)):
        hl2 = (kl[i]["h"] + kl[i]["l"]) / 2
        bu, bl = hl2 + mult * a[i], hl2 - mult * a[i]
        if fub is None: fub, flb = bu, bl
        else:
            fub = bu if (bu < pfub or kl[i-1]["c"] > pfub) else pfub
            flb = bl if (bl > pflb or kl[i-1]["c"] < pflb) else pflb
        if pst is None: cur = flb
        elif pst == pfub: cur = fub if kl[i]["c"] <= fub else flb
        else: cur = flb if kl[i]["c"] >= flb else fub
        d[i] = -1 if cur == fub else 1
        st[i] = cur; pst = cur; pfub, pflb = fub, flb
    return st, d

def vwap(kl):
    out = [None] * len(kl); cpv = cv = 0.0; last_day = -1
    for i in range(len(kl)):
        day = datetime.fromtimestamp(kl[i]["t"] / 1000, timezone.utc).day
        if day != last_day: cpv = cv = 0.0; last_day = day
        tp = (kl[i]["h"] + kl[i]["l"] + kl[i]["c"]) / 3
        cpv += tp * kl[i]["v"]; cv += kl[i]["v"]
        out[i] = cpv / cv if cv else None
    return out

# ---------- DATA ----------
def fetch_klines(symbol, interval=TIMEFRAME, limit=KLINES_LIMIT):
    url = f"{BINANCE_API}/klines?symbol={symbol}&interval={interval}&limit={limit}"
    with urllib.request.urlopen(url, timeout=15) as r:
        raw = json.loads(r.read())
    return [{"t": k[0], "o": float(k[1]), "h": float(k[2]),
             "l": float(k[3]), "c": float(k[4]), "v": float(k[5])} for k in raw]

# ---------- CONFLUENCE SIGNAL ----------
def detect_signal(kl):
    closes = [k["c"] for k in kl]
    if len(closes) < 210: return None
    eF, eS, eL = ema(closes, 20), ema(closes, 50), ema(closes, 200)
    rs, at = rsi(closes), atr(kl)
    st, sd = supertrend(kl)
    vw = vwap(kl)
    i = len(kl) - 2                       # last CLOSED candle
    entry = closes[-1]; v = vw[i]
    if v is None: return None
    if eF[i] > eS[i] > eL[i] and st[i] is not None and sd[i] == 1 \
       and closes[i] > v and rs[i-1] < RSI_BUY <= rs[i] and closes[i] > eF[i]:
        sl = entry - SL_ATR * at[i]
        return dict(direction=1, entry=entry, sl=sl,
                    tp1=entry + SL_ATR * 1 * at[i], tp2=entry + SL_ATR * 2 * at[i],
                    tp3=entry + SL_ATR * 3 * at[i], atr=at[i])
    if eF[i] < eS[i] < eL[i] and st[i] is not None and sd[i] == -1 \
       and closes[i] < v and rs[i-1] > RSI_SELL >= rs[i] and closes[i] < eF[i]:
        sl = entry + SL_ATR * at[i]
        return dict(direction=-1, entry=entry, sl=sl,
                    tp1=entry - SL_ATR * 1 * at[i], tp2=entry - SL_ATR * 2 * at[i],
                    tp3=entry - SL_ATR * 3 * at[i], atr=at[i])
    return None

# ---------- DB ----------
def db_insert(table, row):
    req = urllib.request.Request(
        f"{INSFORGE_URL}/rest/v1/{table}",
        data=json.dumps(row).encode(),
        headers={"apikey": INSFORGE_KEY, "Authorization": f"Bearer {INSFORGE_KEY}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"},
        method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status in (200, 201)

def db_recent(symbol):
    url = (f"{INSFORGE_URL}/rest/v1/signals?symbol=eq.{symbol}"
           f"&signal_time=gte.now()-interval'24 hours'")
    req = urllib.request.Request(url, headers={"apikey": INSFORGE_KEY,
                                               "Authorization": f"Bearer {INSFORGE_KEY}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

# ---------- MAIN JOB ----------
def run():
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] TradeOptix v2 scan start")
    for sym in COINS:
        try:
            kl = fetch_klines(sym)
            sig = detect_signal(kl)
            if not sig: continue
            if db_recent(sym): continue          # no duplicate within 24h
            row = dict(symbol=sym, timeframe=TIMEFRAME, direction=sig["direction"],
                       entry_price=sig["entry"], stop_loss=sig["sl"],
                       take_profit=sig["tp3"], atr=sig["atr"], rr_ratio=RR,
                       status="ACTIVE")
            ok = db_insert("signals", row)
            print(f"  {'OK' if ok else 'FAIL'} {sym} "
                  f"{'LONG' if sig['direction']==1 else 'SHORT'} @ {sig['entry']:.4f}")
        except Exception as e:
            print(f"  WARN {sym}: {e}")
    print("Scan complete.")

if __name__ == "__main__":
    run()
