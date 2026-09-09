"""
TradeOptix — Signal Engine (Python)
===================================
Runs as a SCHEDULED JOB on InsForge Python (or any cron/platform).
Scans Binance klines every cycle, detects EMA+RSI+ATR swing signals,
stores them in InsForge DB. Frontend reads the `signals` table.

Strategy (identical to frontend / backtest report v2.0):
  Trend : EMA20 > EMA50  -> LONG only | EMA20 < EMA50 -> SHORT only
  Entry : RSI(14) cross above 70 (long) / below 30 (short), price beyond EMA20
  SL    : 2.0 x ATR(14)      TP : 3 x SL distance (1:3 R:R)
  Time-stop: 25 bars

InsForge ke exact SDK calls ke liye unki docs dekho — neeche REST-style
calls diye hain jo har Postgres-backed platform pe chalte hain.
"""

import os, time, json, math
from datetime import datetime, timezone
import urllib.request

# ---------- CONFIG ----------
BINANCE_API = "https://data-api.binance.vision/api/v3"
COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "LINKUSDT", "XRPUSDT",
         "DOGEUSDT", "ADAUSDT"]          # BNB excluded (user request)
TIMEFRAME = "1d"                            # verified timeframe only!
KLINES_LIMIT = 400
FEE_RT = 0.002                              # 0.1% per side, round trip
MIN_AGE_BARS = 3                            # same signal dobara mat dalo
RR = 3.0
SL_ATR = 2.0
MAX_HOLD = 25
RSI_BUY, RSI_SELL = 70.0, 30.0

INSFORGE_URL = os.environ["INSFORGE_URL"]               # e.g. https://xxx.insforge.app
INSFORGE_KEY = os.environ["INSFORGE_SERVICE_KEY"]       # service_role key (SECRET!)

# ---------- INDICATORS (pure python, no pandas needed on server) ----------
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

# ---------- DATA ----------
def fetch_klines(symbol, interval=TIMEFRAME, limit=KLINES_LIMIT):
    url = f"{BINANCE_API}/klines?symbol={symbol}&interval={interval}&limit={limit}"
    with urllib.request.urlopen(url, timeout=15) as r:
        raw = json.loads(r.read())
    return [{"t": k[0], "o": float(k[1]), "h": float(k[2]),
             "l": float(k[3]), "c": float(k[4])} for k in raw]

# ---------- SIGNAL ----------
def detect_signal(kl):
    closes = [k["c"] for k in kl]
    eF, eS, rs, at = ema(closes, 20), ema(closes, 50), rsi(closes), atr(kl)
    i = len(kl) - 2                                    # last CLOSED candle
    if i < 51: return None
    entry = closes[-1]
    if eF[i] > eS[i] and rs[i-1] < RSI_BUY <= rs[i] and closes[i] > eF[i]:
        sl = entry - SL_ATR * at[i]
        return dict(direction=1, entry=entry, sl=sl, tp=entry + SL_ATR * RR * at[i], atr=at[i])
    if eF[i] < eS[i] and rs[i-1] > RSI_SELL >= rs[i] and closes[i] < eF[i]:
        sl = entry + SL_ATR * at[i]
        return dict(direction=-1, entry=entry, sl=sl, tp=entry - SL_ATR * RR * at[i], atr=at[i])
    return None

# ---------- DB (InsForge REST/PostgREST style; SDK ho to swap kar lo) ----------
def db_insert(table, row):
    req = urllib.request.Request(
        f"{INSFORGE_URL}/rest/v1/{table}",
        data=json.dumps(row).encode(),
        headers={"apikey": INSFORGE_KEY, "Authorization": f"Bearer {INSFORGE_KEY}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"},
        method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status in (200, 201)

def db_recent_signal(symbol, minutes=60 * 24):
    url = (f"{INSFORGE_URL}/rest/v1/signals?symbol=eq.{symbol}"
           f"&signal_time=gte.{datetime.now(timezone.utc).isoformat()}")
    req = urllib.request.Request(url, headers={"apikey": INSFORGE_KEY,
                                               "Authorization": f"Bearer {INSFORGE_KEY}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

# ---------- MAIN JOB ----------
def run():
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] TradeOptix scan start")
    for sym in COINS:
        try:
            kl = fetch_klines(sym)
            sig = detect_signal(kl)
            if not sig:
                continue
            # duplicate mat dalo — aaj ka signal already hai kya?
            if db_recent_signal(sym):
                continue
            row = dict(symbol=sym, timeframe=TIMEFRAME, direction=sig["direction"],
                       entry_price=sig["entry"], stop_loss=sig["sl"],
                       take_profit=sig["tp"], atr=sig["atr"], rr_ratio=RR, status="ACTIVE")
            ok = db_insert("signals", row)
            print(f"  {'✅' if ok else '❌'} {sym} {'LONG' if sig['direction']==1 else 'SHORT'} "
                  f"@ {sig['entry']:.4f} SL {sig['sl']:.4f} TP {sig['tp']:.4f}")
        except Exception as e:
            print(f"  ⚠️ {sym} error: {e}")
    print("Scan complete. Sleeping...")

if __name__ == "__main__":
    run()   # InsForge scheduled job me ise har 30–60 min call karo
