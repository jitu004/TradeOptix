# TradeOptix 🚀

Crypto Swing Trading Signals App — Binance real-time data, 5-saal verified backtest, SL Guard alerts, InsForge cloud DB.

## Features
- **Live Signals:** LONG / SHORT / NO TRADE — Entry, SL (2×ATR), TP (1:3 R:R), holding-time estimate
- **Real-time Chart:** Binance klines + WebSocket price stream, EMA lines, SL/TP levels
- **Backtest Engine:** 5-saal daily backtest (fees included) — equity curve + trade log
- **SL Guard 🛡️:** SL hit se PEHLE warning (sound + browser notification)
- **Cloud DB (InsForge):** Signals history, tracked trades, alert log — sab cloud me saved
- **Edge Badge:** 5-saal win-rate ≥50% hone par hi trade suggest

## Project Structure
```
TradeOptix/
├── index.html                  # Frontend app
├── backend/
│   ├── db_client.js            # InsForge DB config (URL + Anon key yahan)
│   ├── schema.sql              # DB tables (SQL Editor me run karo)
│   └── signal_engine.py        # Python scanner (InsForge Functions me)
├── README.md
└── .gitignore
```

## 🚀 Deployment (InsForge + GitHub + Mac)

### Step 1 — GitHub push (Terminal)
```bash
cd ~/TradeOptix
git add .
git commit -m "TradeOptix with DB"
git push
```

### Step 2 — Node.js install (CLI ke liye, sirf pehli baar)
```bash
node -v        # check: agar version dikhe to skip karo
# nahi dikhe to:
brew install node
```

### Step 3 — InsForge CLI se project link karo
```bash
cd ~/TradeOptix
npx @insforge/cli link --project-id dbe98aa6-4c3c-4910-ad3c-e5454dc8f9e5
```
> Project ID upar wale me se hai — InsForge Dashboard → Settings/Install me milta hai.

### Step 4 — Site deploy karo
```bash
npx @insforge/cli deploy .
```
(agar error aaye to `npx @insforge/cli --help` chalao — exact deploy command wahan likhi hogi, ya mujhe output bhejo)

### Step 5 — Database tables banao
1. InsForge Dashboard → **SQL Editor** (left sidebar)
2. `backend/schema.sql` kholo (VS Code/Notepad), poora copy karo
3. SQL Editor me paste → **Run** ✅
4. 3 tables banengi: `signals`, `tracked_trades`, `alerts`

### Step 6 — API Keys daalo
1. Dashboard → **API Keys** (ya Install modal → Direct Connect → API Keys)
2. **Anon/Public Key** copy karo → `backend/db_client.js` me paste karo:
```js
window.INSFORGE_URL = 'https://YOUR-PROJECT.insforge.app';
window.INSFORGE_ANON_KEY = 'eyJhbGciOi...';   // apni anon key
```
3. **Service Role Key** copy karke RAKH LO (Python engine ke liye — sirf InsForge Functions me use hogi, kabhi frontend/git me nahi!)

### Step 7 — Push karo (DB config ke saath)
```bash
git add .
git commit -m "DB config"
git push
npx @insforge/cli deploy .    # dubara deploy
```

### Step 8 — Python Signal Engine (background job)
1. Dashboard → **Functions** → New Function → Python
2. `backend/signal_engine.py` ka content paste karo
3. Env vars set karo:
   - `INSFORGE_URL` = project URL
   - `INSFORGE_SERVICE_KEY` = service role key
4. Schedule: har **30 minute** (ya hourly)
5. Save & Deploy — engine ab Binance scan karke DB me signals daalega ✅

### Step 9 — Verify 🎉
App kholo → left panel me **"📡 Signals History (Cloud DB)"** — "✅ DB Connected" dikhe = sab perfect!

## Strategy
EMA(20/50) trend + RSI(14) 70/30 momentum cross + ATR risk mgmt. 5-saal backtest report: fees included, ETH 61.5% win rate.

## v4 Upgrade — 10 signals/day + TRUE/FALSE + weekly + logs + sentiment (2026-09-10)

### Kya naya hai
- **~10 signals/day quota:** engine pehle 1D full-confluence (T1) deta hai, phir 4H tiered-relax (T2→T4) se quota fill karta hai. Har signal pe tier badge.
- **TRUE/FALSE tracking:** `signal_resolver` har 5 min me ACTIVE signals check karta hai — TP hit → result=true ✅, SL hit → result=false ❌, pnl% DB me.
- **Weekly Report panel:** last 7 din — total, true %, false %, kaunse-kaunse hue.
- **Live Logs panel:** engine/resolver/backtest ka har action `engine_logs` table me — frontend har 3 sec me dikhata hai.
- **Server-side backtest:** "Run Backtest" button ab InsForge function call karta hai — compute kabhi browser me nahi hota. Results `backtest_runs` me save.
- **Market Sentiment (v4.1):** BTC momentum, trend, market breadth, funding rate, volatility — 5 components se 0–100 score. Engine isko quality gate ki tarah use karta hai (extreme greed → sirf SHORT fade, extreme fear → sirf LONG dip-buy). 4H quota-fill signals ke liye **1D trend alignment (MTF)** zaroori hai.

### Deploy steps (v3 ke upar)
```bash
cd ~/TradeOptix && unzip -o ~/Downloads/TradeOptix_v4.zip
git add . && git commit -m "v4: quota engine + resolver TRUE/FALSE + weekly + logs + sentiment"
git push && npx @insforge/cli deployments deploy
```
1. **SQL Editor:** `backend/schema_v4.sql` paste → Run (ALTER + 3 nayi tables: engine_logs, backtest_runs, sentiment)
2. **Functions:**
   - `signal_engine` → code REPLACE karo v4.1 wale se — schedule 30 min (same)
   - NEW `signal_resolver` — `backend/signal_resolver.js` — schedule **5 min**
   - NEW `public_weekly` — public ON
   - NEW `public_logs` — public ON
   - NEW `server_backtest` — public ON
   - NEW `market_sentiment` — `backend/market_sentiment.js` — schedule **15 min**, public ON
   - Env vars sab me: `INSFORGE_URL` + `INSFORGE_SERVICE_KEY`
3. Verify: site pe 3 naye panels — Weekly Report, Engine Logs, Market Sentiment

### v4.2 additions — db_setup + mobile alerts
- **`db_setup` function (SQL Editor ki jagah):** SQL Editor DDL scripts reject karta hai ("security reasons").
  Isliye `backend/db_setup.js` ko function banao `db_setup` naam se, env vars set karo
  (`INSFORGE_URL`, `INSFORGE_SERVICE_KEY`), deploy karo, phir browser me kholo:
  `https://r3pjdfkc.function2.insforge.app/db_setup` — saari tables/columns khud ban jayengi.
  Ek baar chalne ke baad function delete bhi kar sakte ho.
- **Mobile alerts (WhatsApp via CallMeBot — free):**
  1. WhatsApp me +34 644 51 95 23 ko contact me add karo (naam kuch bhi do, jaise "CallMeBot")
  2. Us number ko ye exact message bhejo: `I allow callmebot to send me messages`
  3. Reply me `API Activated...` + aapka **apikey** aayega
  4. InsForge me `signal_engine` aur `signal_resolver` dono functions me env vars add karo:
     `WHATSAPP_PHONE` = aapka number country code ke saath (e.g. `+919876543210`)
     `WHATSAPP_APIKEY` = CallMeBot ka apikey
  5. Ab har naye signal + har TRUE/FALSE result pe **WhatsApp** pe message aayega.
  (Note: free tier me 1 msg / ~5 sec limit hai — 10 signals/day ke liye enough hai.
   Official WhatsApp Business API (Meta) zyada reliable hai par uske liye business account + setup chahiye.)

### v4.4 — Signup → Admin Approval → Email (complete access flow)
1. **v4.js me 2 cheezein paste karo:**
   - `ANON_KEY` = Secrets se `INSFORGE_ANON_KEY` ki value
   - `ADMIN_EMAIL` = aapka email (Secrets ke `ADMIN_EMAILS` se match hona chahiye)
2. **Auth settings:** Dashboard → Authentication → Email provider ON → **"Allow new sign ups" ON rakho**
   (real control humara approval gate hai — bina approve login nahi hoga)
3. **Secrets add karo** (Dashboard → Secrets):
   - `ADMIN_EMAILS` = aapka email (e.g. `aap@gmail.com`) — isse multiple admin comma-separated bhi ho sakte hain
   - `BREVO_KEY` = brevo.com free account → API keys → "Generate a new API key" (approval emails ke liye, 300 free/day)
4. **4 functions deploy + setup:**
   ```bash
   npx @insforge/cli functions deploy request_access --file backend/request_access.js
   npx @insforge/cli functions deploy check_approval --file backend/check_approval.js
   npx @insforge/cli functions deploy approve_user --file backend/approve_user.js
   npx @insforge/cli functions deploy public_requests --file backend/public_requests.js
   npx @insforge/cli functions deploy log_login --file backend/log_login.js
   npx @insforge/cli functions deploy public_logins --file backend/public_logins.js
   npx @insforge/cli functions invoke db_setup --method GET   # access_requests table
   ```
5. **Site deploy:** `git add . && git commit -m "v4.4 approval flow" && git push && npx @insforge/cli deployments deploy`

**Flow:** User "Request Access" → signup + pending record → aapko email + "🛡️ Access Requests"
panel me dikhta hai → **Approve** dabao → user ko email jata hai → user login karke app use karta hai.
"🔐 Login Activity" panel me har login record hota hai.

## ⚠️ Disclaimer
Education/analytics ke liye hai, financial advice nahi. Backtest ≠ future guarantee. Kabhi bina SL ke trade mat karo.
