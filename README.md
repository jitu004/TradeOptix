# TradeOptix 🚀

Crypto Swing Trading Signals App — Binance real-time data, 5-saal verified backtest, SL Guard alerts.

![stack](https://img.shields.io/badge/stack-HTML%2FJS%20%2B%20InsForge-blue) ![strategy](https://img.shields.io/badge/strategy-EMA%2BRSI%2BATR%20(1%3A3%20RR)-green)

## Features
- **Live Signals:** LONG / SHORT / NO TRADE with Entry, SL (2×ATR), TP (1:3 R:R), holding-time estimate
- **Real-time Chart:** Binance klines + WebSocket price stream, EMA lines, SL/TP levels, trade markers
- **Backtest Engine:** 5-saal daily backtest (fees included) with equity curve + trade log
- **SL Guard 🛡️:** Price SL ke 0.5×ATR ke andar aate hi sound + browser notification (SL hit se PEHLE)
- **Edge Badge:** Sirf tab trade karo jab coin ka 5-saal win-rate ≥50% ho

## Strategy
EMA(20/50) trend + RSI(14) 70/30 momentum cross + ATR(14) risk mgmt. Full report: [`BACKTEST_REPORT.md`](../BACKTEST_REPORT.md)

## Project Structure
```
TradeOptix/
├── index.html              # Frontend (single-file app)
├── README.md
├── .gitignore
└── backend/
    ├── schema.sql          # InsForge/Postgres DB schema
    └── signal_engine.py    # Python signal scanner (scheduled job)
```

## Local Run
Koi build nahi — bas `index.html` ko browser me kholo (internet chahiye). Ya:
```bash
python -m http.server 8080   # http://localhost:8080
```

## Deploy Steps (InsForge + GitHub)
See [DEPLOYMENT](#deployment) below.

---

## Deployment

### 1. GitHub pe push
```bash
git init
git add .
git commit -m "TradeOptix v1.0 — signals app"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/TradeOptix.git
git push -u origin main
```

### 2. InsForge project banao
1. [InsForge](https://insforge.dev) pe account banao → **New Project** → naam `TradeOptix`
2. Dashboard se milega: **Project URL** + **Anon Key** + **Service Role Key** (ye secret hai, kabhi git mat dalna!)

### 3. Database
InsForge Dashboard → **SQL Editor** → [`backend/schema.sql`](backend/schema.sql) ka content paste karke **Run** karo.

### 4. Frontend config
`index.html` me `<script>` ke andar ye 2 line add karo (InsForge keys ke saath):
```js
const INSFORGE_URL = 'https://<YOUR-PROJECT>.insforge.app';
const INSFORGE_ANON_KEY = '<YOUR_ANON_KEY>';
```
(TODO comment dhundo — `backend/db_client.js` bhi bana sakte ho; abhi app fully static chalta hai, DB sirf signals history ke liye optional hai.)

### 5. Static Hosting (2 options)
- **Option A — InsForge Hosting:** Dashboard → Hosting → GitHub repo connect karo → auto-deploy ✅ (recommended, sab ek jagah)
- **Option B — Vercel/Netlify:** repo connect karo, root = project folder, no build command

### 6. Python Signal Engine (background job)
[`backend/signal_engine.py`](backend/signal_engine.py) InsForge ke Python functions/scheduled-jobs me deploy karo:
- Har 30 min chalega, 8 coins scan karega
- Naya signal mile to DB me insert karega
- Frontend DB se recent signals dikhayega
- Env vars set karo: `INSFORGE_URL`, `INSFORGE_SERVICE_KEY`

### 7. Secrets ka khayal ⚠️
`.env` / API keys **kabhi GitHub mat push karo** — `.gitignore` me already hai. InsForge dashboard ke env-vars section me daalo.

### 8. Live 🎉
URL milte hi app live! Ab custom domain (e.g. `tradeoptix.yourdomain.com`) bhi attach kar sakte ho.

## Risk Disclaimer
Ye app education/analytics ke liye hai, financial advice nahi. Backtest past performance hai, future guarantee nahi. Kabhi bina SL ke trade mat karo.
