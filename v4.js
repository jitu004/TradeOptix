/* ================= TRADEOPTIX V4 ADD-ONS =================
   Server backtest + weekly TRUE/FALSE report + live engine logs + market sentiment
   Ye file index.html ke BAAD load hoti hai — yahan ke functions purane override karte hain. */

const SV_BASE = 'https://r3pjdfkc.function2.insforge.app';

/* --- Backtest ab SIRF InsForge backend par compute hota hai — browser sirf result dikhata hai --- */
async function runBT() {
  const btn = document.getElementById('btnBacktest');
  if (btn) { btn.textContent = '⏳ Server computing…'; btn.disabled = true; }
  try {
    const r = await fetch(SV_BASE + '/server_backtest?symbol=' + encodeURIComponent(sym));
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('btWin', d.winRate + '%'); set('btPf', d.profitFactor);
    set('btRet', (d.returnPct > 0 ? '+' : '') + d.returnPct + '%');
    set('btDd', d.maxDD + '%'); set('btN', d.total);
    set('btAvgW', '+' + d.avgWin + '%'); set('btAvgL', '-' + d.avgLoss + '%');
    set('btHold', d.avgHoldBars + ' bars');
    const tl = document.getElementById('tradeLog');
    if (tl) tl.innerHTML = (d.sample || []).map(t =>
      `<div class="trade-row"><span style="color:${t.side === 'LONG' ? 'var(--green)' : 'var(--red)'}">${t.side}</span><span>${t.exitReason}</span><span>${t.holdBars}b</span><span style="color:${t.pnl > 0 ? 'var(--green)' : 'var(--red)'}">${t.pnl > 0 ? '+' : ''}${t.pnl}%</span></div>`
    ).join('') || '<div style="color:var(--muted);text-align:center;padding:12px">No trades</div>';
    const ec = document.getElementById('equityChart');
    if (ec && ec.getContext) {
      let cum = 0; const pts = [0, ...(d.sample || []).map(t => cum += t.pnl)];
      const ctx = ec.getContext('2d'); ec.width = (ec.clientWidth * 2) || 600; ec.height = 400;
      ctx.clearRect(0, 0, ec.width, ec.height);
      const mn = Math.min(...pts), mx = Math.max(...pts), rg = (mx - mn) || 1;
      ctx.beginPath(); ctx.strokeStyle = '#f0b90b'; ctx.lineWidth = 3;
      pts.forEach((p, i) => { const x = i / (pts.length - 1 || 1) * ec.width, y = 380 - ((p - mn) / rg) * 360; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
  } catch (e) { alert('Server backtest error: ' + e.message); }
  finally { if (btn) { btn.textContent = '⚡ Run Backtest (Server — InsForge)'; btn.disabled = false; } }
}

/* --- Live Signals: entry/SL/TP + pop-up toast on new signal --- */
let lastSigId = null;
async function loadDbSignals() {
  const st = document.getElementById('dbStatus'), list = document.getElementById('dbSignals');
  if (!st || !list) return;
  try {
    const r = await fetch(SV_BASE + '/public_signals');
    if (!r.ok) throw 0;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) { st.textContent = 'Feed live - no signals yet. Engine will add them.'; return; }
    st.textContent = 'Live feed - ' + rows.length + ' recent signals';
    const badge = s => s.status === 'ACTIVE' ? '<span class="badge badge-strong">ACTIVE</span>'
      : s.result === true ? '<span class="badge" style="background:#12361f;color:#3fb950">TRUE ✅</span>'
      : s.result === false ? '<span class="badge" style="background:#3d1d1d;color:#f85149">FALSE ❌</span>'
      : '<span class="badge badge-mid">' + s.status + '</span>';
    const fmt6 = v => { const n = +v; return isFinite(n) ? (n >= 1 ? n.toLocaleString('en-US') : n.toPrecision(4)) : v; };
    list.innerHTML = rows.map(s => {
      const d = new Date(s.signal_time || Date.now());
      return `<div class="trade-row"><span style="color:${s.direction === 1 ? 'var(--green)' : 'var(--red)'}">${s.direction === 1 ? 'LONG' : 'SHORT'}</span>
      <span>${String(s.symbol).replace('USDT', '')}</span><span>@ ${fmt6(s.entry_price)}</span>
      <span style="color:var(--red);font-size:10px">SL ${fmt6(s.stop_loss)}</span>
      <span style="color:var(--green);font-size:10px">TP ${fmt6(s.take_profit)}</span>
      <span style="color:var(--muted)">${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="badge ${s.timeframe === '4h' ? 'badge-mid' : 'badge-strong'}">${(s.timeframe || '').toUpperCase()}${s.tier > 1 ? ' T' + s.tier : ''}</span>${badge(s)}</div>`;
    }).join('');
    const top = rows[0];
    if (top && top.id !== lastSigId) {
      const isNew = lastSigId !== null && (Date.now() - new Date(top.signal_time).getTime() < 10 * 60000);
      const first = lastSigId === null;
      lastSigId = top.id;
      if (isNew && !first) sigToast(top);
    }
  } catch (e) { st.textContent = 'Feed unreachable — please deploy the v4 functions (see README).'; }
}

function sigToast(s) {
  document.getElementById('sigToast')?.remove();
  const fmt6 = v => { const n = +v; return isFinite(n) ? (n >= 1 ? n.toLocaleString('en-US') : n.toPrecision(4)) : v; };
  const el = document.createElement('div');
  el.id = 'sigToast';
  el.style.cssText = 'position:fixed;top:52px;right:12px;z-index:10000;background:#161b22;border:1px solid #f0b90b;border-radius:12px;padding:14px 16px;width:300px;color:#e6edf3;box-shadow:0 10px 34px rgba(0,0,0,.55)';
  el.innerHTML = `<style>@keyframes sigIn{from{transform:translateX(360px);opacity:0}to{transform:translateX(0);opacity:1}}</style>
    <div style="animation:sigIn .45s ease">
    <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:11px;color:#f0b90b;font-weight:800;letter-spacing:1px">⚡ NEW SIGNAL</div><span id="sigToastX" style="cursor:pointer;color:#8b949e;font-size:14px">✕</span></div>
    <div style="font-size:16px;font-weight:800;margin:6px 0;color:${s.direction === 1 ? 'var(--green)' : 'var(--red)'}">${s.direction === 1 ? '🟢 LONG' : '🔴 SHORT'} ${String(s.symbol).replace('USDT', '')} <span style="font-size:10px;color:var(--muted)">${(s.timeframe || '').toUpperCase()}${s.tier > 1 ? ' T' + s.tier : ''}</span></div>
    <div style="font-size:12px;color:#c9d1d9;line-height:1.8">Entry: <b>${fmt6(s.entry_price)}</b><br>SL: <b style="color:var(--red)">${fmt6(s.stop_loss)}</b> &nbsp; TP: <b style="color:var(--green)">${fmt6(s.take_profit)}</b></div>
    </div>`;
  document.body.appendChild(el);
  document.getElementById('sigToastX').onclick = () => el.remove();
  setTimeout(() => { el.style.transition = 'opacity .5s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 9000);
}

/* --- Weekly report: week me kitne signals, kitne % true, kaunse-kaunse --- */
async function loadWeekly() {
  const el = document.getElementById('weeklyStats'), list = document.getElementById('weeklyList');
  if (!el) return;
  try {
    const d = await (await fetch(SV_BASE + '/public_weekly')).json();
    if (d.error) throw new Error(d.error);
    el.innerHTML = `<div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:8px">
      <div class="stat"><div class="v">${d.total}</div><div class="k">Total</div></div>
      <div class="stat"><div class="v" style="color:var(--green)">${d.trueCount}</div><div class="k">True ✅</div></div>
      <div class="stat"><div class="v" style="color:var(--red)">${d.falseCount}</div><div class="k">False ❌</div></div></div>
    <div style="height:8px;background:#3d1d1d;border-radius:4px;overflow:hidden;margin-bottom:8px"><div style="height:100%;background:var(--green);width:${d.truePct}%"></div></div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:8px">True rate: <b style="color:var(--text)">${d.truePct}%</b> · Pending: ${d.pending} · Last 7 days</div>`;
    list.innerHTML = (d.list || []).filter(s => s.status !== 'ACTIVE').map(s => {
      const r = new Date(s.resolved_at || s.signal_time);
      return `<div class="trade-row"><span style="color:${s.direction === 1 ? 'var(--green)' : 'var(--red)'}">${s.direction === 1 ? 'LONG' : 'SHORT'}</span>
      <span>${String(s.symbol).replace('USDT', '')}</span>
      <span style="color:${s.result ? 'var(--green)' : 'var(--red)'}">${s.result ? 'TRUE' : 'FALSE'} ${s.pnl_pct != null ? ((s.pnl_pct > 0 ? '+' : '') + Number(s.pnl_pct).toFixed(2) + '%') : ''}</span>
      <span style="color:var(--muted)">${r.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></div>`;
    }).join('') || '<div style="color:var(--muted);text-align:center;padding:12px">No resolved signals yet this week</div>';
  } catch (e) { el.innerHTML = '<div class="note">Weekly report API is not deployed yet — please deploy backend/public_weekly.js.</div>'; }
}

/* --- Live engine logs (har 3 sec poll) --- */
let lastLogTs = 0;
async function loadEngineLogs() {
  const box = document.getElementById('engineLogs');
  if (!box) return;
  try {
    const rows = await (await fetch(SV_BASE + '/public_logs')).json();
    if (!Array.isArray(rows)) return;
    const fresh = rows.filter(l => new Date(l.ts).getTime() > lastLogTs);
    if (!fresh.length && lastLogTs) return;
    lastLogTs = Math.max(lastLogTs, ...rows.map(l => new Date(l.ts).getTime()));
    const color = { 'SIGNAL': 'var(--yellow)', 'TRUE': 'var(--green)', 'FALSE': 'var(--red)', 'ERROR': 'var(--red)', 'WARN': 'var(--yellow)' };
    box.insertAdjacentHTML('afterbegin', fresh.reverse().map(l =>
      `<div style="padding:2px 0;border-bottom:1px dashed var(--border)"><span style="color:var(--muted)">${new Date(l.ts).toLocaleTimeString('en-GB')}</span> <b style="color:${color[l.level] || 'var(--blue)'}">${l.level}</b> ${l.message}</div>`
    ).join(''));
    while (box.children.length > 120) box.removeChild(box.lastChild);
  } catch (e) { /* backend offline — kuch mat karo */ }
}

/* --- Market sentiment: 0-100 score + 5 components (har 60 sec) --- */
function sentColor(s) { return s >= 75 ? '#f85149' : s >= 55 ? '#f0b90b' : s > 45 ? '#8b949e' : s > 25 ? '#3fb950' : '#1f6feb'; }
async function loadSentimentGauge() {
  const el = document.getElementById('sentPanel');
  if (!el) return;
  try {
    const r = await fetch(SV_BASE + '/market_sentiment');
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    const c = d.components || {};
    const bar = v => `<div style="display:flex;align-items:center;gap:8px;margin:3px 0"><div style="width:118px;font-size:11px;color:var(--muted)">${v[0]}</div><div style="flex:1;height:6px;background:var(--panel2);border-radius:3px;overflow:hidden"><div style="height:100%;width:${v[1]}%;background:${sentColor(v[1])}"></div></div><div style="width:34px;text-align:right;font-size:11px;font-family:var(--mono)">${Math.round(v[1])}</div></div>`;
    el.innerHTML = `<div style="text-align:center;margin-bottom:10px">
        <div style="font-size:38px;font-weight:800;font-family:var(--mono);color:${sentColor(d.score)}">${d.score}<span style="font-size:14px;color:var(--muted)">/100</span></div>
        <div style="font-size:12px;font-weight:800;letter-spacing:1px;color:${sentColor(d.score)}">${d.label}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">${d.bias || ''} · ${new Date(d.at).toLocaleTimeString('en-GB')}</div></div>
      ${bar(['BTC Momentum 24h', c.btc_momentum_24h || 0])}
      ${bar(['BTC Trend 4H', c.btc_trend_4h || 0])}
      ${bar(['Market Breadth', c.market_breadth || 0])}
      ${bar(['Funding Sentiment', c.funding_sentiment || 0])}
      ${bar(['Volatility Regime', c.volatility_regime || 0])}
      <div style="font-size:10px;color:var(--muted);margin-top:8px">Sentiment signal engine ka quality gate hai — ye decide karta hai kaunse direction ke trades allowed hain.</div>`;
  } catch (e) { el.innerHTML = '<div class="note">Sentiment engine is not deployed yet — please deploy backend/market_sentiment.js (schedule: every 15 min, public access ON).</div>'; }
}

/* ================= AUTH GATE (InsForge native auth API — direct fetch) =================
   Login:    POST /api/auth/sessions        {email,password} -> accessToken + user
   Signup:   POST /api/auth/users           {email,password} -> user (approval ke liye request)
   Verify:   GET  /api/auth/sessions/current (Bearer) -> user   [backend functions]
   ANON_KEY: Dashboard -> Secrets -> INSFORGE_ANON_KEY / ANON_KEY value. */
const ANON_KEY = 'anon_d4e349cf0f19d19a9a53315e4b667de23297b526c873fe3c4702b22792724c8c';
const IF_BASE = 'https://r3pjdfkc.eu-central.insforge.app';
const ADMIN_EMAIL = 'j.nagarkoti@outlook.com';
let authToken = null;
let currentUser = null;

async function apiPost(path, body) {
  const r = await fetch(IF_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d };
}

function pickToken(d) {
  return d.accessToken || d.access_token || d.token ||
    (d.session && (d.session.accessToken || d.session.token)) ||
    (d.data && (d.data.accessToken || d.data.token)) || '';
}
function pickUser(d) {
  return d.user || (d.data && d.data.user) || d.profile ||
    (d.data && d.data.email ? d.data : null) || (d.email ? d : null);
}

function lockScreen(html) {
  document.documentElement.style.overflow = 'hidden';
  for (const el of document.body.children) el.style.visibility = 'hidden';
  document.getElementById('authGate')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="authGate" style="position:fixed;inset:0;z-index:9999;background:#0b0e11;display:flex;align-items:center;justify-content:center">${html}</div>`);
}

function unlockApp() {
  document.documentElement.style.overflow = '';
  for (const el of document.body.children) el.style.visibility = '';
}

async function checkApproval(email) {
  try {
    const r = await fetch(SV_BASE + '/check_approval', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return (await r.json()).approved === true;
  } catch (e) { return false; }
}

async function submitAccessRequest(email, uid) {
  try {
    await fetch(SV_BASE + '/request_access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, uid }),
    });
  } catch (e) { /* non-fatal */ }
}

function saveAuth(user, token) {
  currentUser = user;
  authToken = token;
  try { localStorage.setItem('tfx_auth', JSON.stringify({ email: user.email, accessToken: token })); } catch (e) {}
}

function clearAuth() {
  currentUser = null; authToken = null;
  try { localStorage.removeItem('tfx_auth'); } catch (e) {}
}

const TFX_CSS = `<style>@keyframes tfx-run{0%{transform:translateX(-26px)}100%{transform:translateX(26px)}}@keyframes tfx-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes tfx-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-9px)}40%,80%{transform:translateX(9px)}}.tfx-run{display:inline-block;animation:tfx-run 1.1s ease-in-out infinite alternate}.tfx-bob{display:inline-block;animation:tfx-bob 1s ease-in-out infinite}.tfx-shake{animation:tfx-shake .45s ease}</style>`;

function tfxMascot(size) {
  return TFX_CSS + `<span class="tfx-run" style="font-size:${size}px">🏃‍♂️💨</span>
    <span class="tfx-bob" style="font-size:${Math.round(size * 0.62)}px">🤔</span>
    <span class="tfx-bob" style="font-size:${Math.round(size * 0.5)}px;animation-delay:.4s">❓</span>
    <span class="tfx-bob" style="font-size:${Math.round(size * 0.5)}px;animation-delay:.7s">❓</span>`;
}

function tfxFail(box) {
  const card = document.getElementById('loginCard');
  if (card) { card.classList.remove('tfx-shake'); void card.offsetWidth; card.classList.add('tfx-shake'); }
  if (box) box.innerHTML = `<span class="tfx-bob" style="font-size:42px">😵</span> <span style="font-size:24px">💥</span> <span class="tfx-run" style="font-size:20px">🍌</span> <span class="tfx-bob" style="font-size:22px;animation-delay:.3s">🙈</span>`;
}

function showLogin(msg) {
  lockScreen(`
    <div id="loginCard" style="background:#161b22;border:1px solid #30363d;border-radius:14px;padding:32px 36px;width:360px;color:#e6edf3">
      <div id="tfxMascotBox" style="text-align:center;white-space:nowrap;min-height:6px"></div>
      <div style="font-size:22px;font-weight:800;margin-bottom:4px;text-align:center">⚡ TRADE<span style="color:#f0b90b">OPTIX</span></div>
      <div style="font-size:12px;color:#8b949e;margin-bottom:16px;text-align:center">Private access — please sign in to continue</div>
      <input id="lgEmail" type="email" placeholder="Email" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:10px 12px;border-radius:8px;margin-bottom:10px;font-size:14px">
      <input id="lgPass" type="password" placeholder="Password" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:14px">
      <button id="lgBtn" style="width:100%;background:#f0b90b;border:none;color:#000;font-weight:800;padding:11px;border-radius:8px;font-size:14px;cursor:pointer">Sign In</button>
      <div style="text-align:right;margin-top:8px"><a href="#" id="lnkForgot" style="font-size:11px;color:#58a6ff;text-decoration:none">Forgot password?</a></div>
      <div id="lgMsg" style="font-size:12px;color:${(msg || '').includes('✅') || (msg || '').includes('📧') ? '#3fb950' : '#f85149'};margin-top:10px;min-height:16px">${msg || ''}</div>
      <div style="font-size:11px;color:#8b949e;margin-top:14px;border-top:1px solid #30363d;padding-top:10px">Accounts are created by the site administrator. Need access? Contact the admin.</div>
    </div>`);
  document.getElementById('lnkForgot').onclick = (e) => { e.preventDefault(); showForgot(); };
  const go = async () => {
    const b = document.getElementById('lgBtn'), m = document.getElementById('lgMsg');
    const em = document.getElementById('lgEmail').value.trim();
    const pw = document.getElementById('lgPass').value;
    b.textContent = 'Signing in…'; b.disabled = true; m.textContent = ''; m.style.color = '#f85149';
    try {
      const res = await apiPost('/api/auth/sessions', { email: em, password: pw });
      const token = pickToken(res.data), usr = pickUser(res.data);
      if (!res.ok || !token) {
        m.textContent = 'Oops! ' + ((res.data && (res.data.message || res.data.error)) || 'Wrong email or password') + ' — try again 🙃';
        tfxFail(document.getElementById('tfxMascotBox'));
        b.textContent = 'Sign In'; b.disabled = false;
        return;
      }
      if (usr && (usr.emailVerified === false || usr.email_verified === false)) {
        apiPost('/api/auth/email/send-verification', { email: em }).catch(() => {});
        showLogin('📧 Please verify your email first — confirmation link sent to your inbox (check spam too).');
        return;
      }
      saveAuth(usr || { email: em }, token);
      await onLogin(usr || { email: em });
    } catch (e) {
      m.textContent = 'Oops! Network error — try again 🙃';
      tfxFail(document.getElementById('tfxMascotBox'));
      b.textContent = 'Sign In'; b.disabled = false;
    }
  };
  document.getElementById('lgBtn').onclick = go;
  document.getElementById('lgPass').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  document.getElementById('lgEmail').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}

function showForgot(msg) {
  lockScreen(`
    <div id="loginCard" style="background:#161b22;border:1px solid #30363d;border-radius:14px;padding:32px 36px;width:360px;color:#e6edf3">
      <div style="text-align:center;margin-bottom:12px;white-space:nowrap">${tfxMascot(44)}</div>
      <div style="font-size:18px;font-weight:800;margin-bottom:4px;text-align:center">Forgot your password?</div>
      <div style="font-size:12px;color:#8b949e;margin-bottom:16px;text-align:center">Even our runner forgets sometimes — we'll email you a reset link.</div>
      <input id="lgEmail" type="email" placeholder="Email" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:14px">
      <button id="lgBtn" style="width:100%;background:#f0b90b;border:none;color:#000;font-weight:800;padding:11px;border-radius:8px;font-size:14px;cursor:pointer">Send Reset Link</button>
      <div style="text-align:center;margin-top:10px"><a href="#" id="lnkBack" style="font-size:11px;color:#58a6ff;text-decoration:none">← Back to Sign In</a></div>
      <div id="lgMsg" style="font-size:12px;color:${(msg || '').includes('✅') ? '#3fb950' : '#f85149'};margin-top:10px;min-height:16px">${msg || ''}</div>
      <div style="font-size:11px;color:#8b949e;margin-top:14px;border-top:1px solid #30363d;padding-top:10px">Reset link email me aayega (spam folder bhi check karo). Link pe click karke naya password set karo.</div>
    </div>`);
  document.getElementById('lnkBack').onclick = (e) => { e.preventDefault(); showLogin(); };
  const go = async () => {
    const b = document.getElementById('lgBtn'), m = document.getElementById('lgMsg');
    const em = document.getElementById('lgEmail').value.trim();
    b.textContent = 'Sending…'; b.disabled = true; m.textContent = ''; m.style.color = '#f85149';
    try {
      const res = await apiPost('/api/auth/email/send-reset-password', { email: em });
      if (res.ok) { m.style.color = '#3fb950'; m.textContent = '✅ Reset link sent! Check your email (and spam folder).'; }
      else { m.textContent = (res.data && (res.data.message || res.data.error)) || 'Failed — try again 🙃'; tfxFail(document.getElementById('tfxMascotBox')); }
      b.textContent = 'Send Reset Link'; b.disabled = false;
    } catch (e) {
      m.textContent = 'Network error — try again 🙃';
      b.textContent = 'Send Reset Link'; b.disabled = false;
    }
  };
  document.getElementById('lgBtn').onclick = go;
  document.getElementById('lgEmail').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
async function recordLogin(email, uid) {
  try {
    await fetch(SV_BASE + '/log_login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, uid }),
    });
  } catch (e) { /* non-fatal */ }
}

async function onLogin(user) {
  await recordLogin(user.email, user.id || user.uid || '');
  document.getElementById('authGate')?.remove();
  unlockApp();
  addLogoutBtn(user.email);
  startApp();
}

function addLogoutBtn(email) {
  document.getElementById('lgOut')?.remove?.();
  document.getElementById('lgUser')?.remove?.();
  document.body.insertAdjacentHTML('beforeend',
    `<div id="lgUser" title="${email}" style="position:fixed;top:10px;right:92px;z-index:9999;font-size:11px;color:#8b949e;background:rgba(13,17,23,.9);padding:7px 11px;border-radius:8px;border:1px solid #30363d;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${email}</div>
     <button id="lgOut" style="position:fixed;top:10px;right:10px;z-index:9999;background:#f0b90b;border:none;color:#000;font-weight:800;padding:7px 14px;border-radius:8px;font-size:11px;cursor:pointer">Logout</button>`);
  document.getElementById('lgOut').onclick = () => { clearAuth(); location.reload(); };
}
/* --- Login Activity panel (sirf logged-in users ko dikhta hai) --- */
async function loadLoginActivity() {
  const el = document.getElementById('loginList');
  if (!el || !authToken) return;
  try {
    const r = await fetch(SV_BASE + '/public_logins', { headers: { Authorization: `Bearer ${authToken}` } });
    if (!r.ok) throw new Error('unauthorized');
    const d = await r.json();
    el.innerHTML = (d.logins || []).map(l =>
      `<div style="padding:4px 0;border-bottom:1px dashed var(--border)">
        <b>${l.email}</b><br>
        <span style="color:var(--muted);font-size:11px">${new Date(l.ts).toLocaleString('en-GB')} · ${String(l.ua || '').slice(0, 60)}</span>
      </div>`).join('') || '<div style="color:var(--muted);text-align:center;padding:12px">No logins recorded yet</div>';
  } catch (e) { el.innerHTML = '<div class="note">Session expired — please sign out and sign in again.</div>'; }
}

/* --- Access Requests panel (sirf admin ko dikhta hai) --- */
async function loadAccessRequests() {
  const el = document.getElementById('reqList');
  if (!el || !authToken) return;
  const me = (currentUser && currentUser.email ? currentUser.email : '').toLowerCase();
  if (me !== ADMIN_EMAIL.toLowerCase()) { el.innerHTML = '<div style="color:var(--muted);text-align:center;padding:12px">Admin only</div>'; return; }
  try {
    const r = await fetch(SV_BASE + '/public_requests', { headers: { Authorization: `Bearer ${authToken}` } });
    if (!r.ok) throw new Error('unauthorized');
    const d = await r.json();
    const pend = (d.requests || []).filter(x => x.status === 'pending');
    el.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-bottom:6px">${pend.length} pending</div>` +
      (d.requests || []).map(q => `<div style="padding:5px 0;border-bottom:1px dashed var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span style="overflow:hidden;text-overflow:ellipsis"><b>${q.email}</b><br><span style="font-size:10px;color:var(--muted)">${new Date(q.requested_at).toLocaleString('en-GB')} · ${q.status}</span></span>
        ${q.status === 'pending' ? `<button data-em="${q.email}" class="apBtn" style="background:#238636;border:none;color:#fff;padding:5px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">Approve</button>` : ''}
      </div>`).join('') || '<div style="color:var(--muted);text-align:center;padding:12px">No requests yet</div>';
    el.querySelectorAll('.apBtn').forEach(btn => {
      btn.onclick = async () => {
        btn.textContent = '…'; btn.disabled = true;
        await fetch(SV_BASE + '/approve_user', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ email: btn.dataset.em }),
        });
        loadAccessRequests();
      };
    });
  } catch (e) { el.innerHTML = '<div class="note">Unable to load access requests.</div>'; }
}

/* --- Right panel: latest signal in futures format --- */
async function loadLiveSignal() {
  const box = document.getElementById('liveSigBox');
  const symEl = document.getElementById('liveSigSym');
  if (!box) return;
  try {
    const rows = await (await fetch(SV_BASE + '/public_signals')).json();
    if (!Array.isArray(rows) || !rows.length) { box.innerHTML = '<div style="color:var(--muted);text-align:center;padding:18px 0">No signals yet — engine scanning…</div>'; if (symEl) symEl.textContent = ''; return; }
    const s = rows.find(x => x.status === 'ACTIVE') || rows[0];
    if (s && s.id !== lastSigId) {
      const isNew = lastSigId !== null && (Date.now() - new Date(s.signal_time).getTime() < 10 * 60000);
      lastSigId = s.id;
      if (isNew && typeof sigToast === 'function') sigToast(s);
    }
    const dir = s.direction === 1 ? 'LONG' : 'SHORT';
    const c = dir === 'LONG' ? 'var(--green)' : 'var(--red)';
    const e = +s.entry_price, sl = +s.stop_loss, tp3 = +s.take_profit;
    const risk = Math.abs(e - sl);
    const sgn = dir === 'LONG' ? 1 : -1;
    const tp1 = e + sgn * risk, tp2 = e + sgn * 2 * risk;
    const fmt = v => { const n = +v; return isFinite(n) ? (n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toPrecision(4)) : v; };
    if (symEl) symEl.textContent = (s.symbol || '').replace('USDT', '') + '/' + (s.timeframe || '').toUpperCase() + (s.tier > 1 ? ' T' + s.tier : '');
    const st = s.status === 'ACTIVE' ? '<span class="badge badge-strong">ACTIVE</span>' : (s.result === true ? '<span class="badge" style="background:#12361f;color:#3fb950">TRUE ✅</span>' : '<span class="badge" style="background:#3d1d1d;color:#f85149">FALSE ❌</span>');
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center"><span>Signal Type: <b style="color:${c};font-size:15px">${dir}</b></span>${st}</div>
      <div>Leverage: <b>Cross (10X)</b></div>
      <div style="margin-top:10px;color:var(--muted);font-size:11px;letter-spacing:1px">ENTRY TARGETS</div>
      <div>1) <b style="color:var(--yellow)">${fmt(e)}</b></div>
      <div style="margin-top:10px;color:var(--muted);font-size:11px;letter-spacing:1px">TAKE-PROFIT TARGETS</div>
      <div>1) <b style="color:var(--green)">${fmt(tp1)}</b></div>
      <div>2) <b style="color:var(--green)">${fmt(tp2)}</b></div>
      <div>3) <b style="color:var(--green)">${fmt(tp3)}</b></div>
      <div style="margin-top:10px;color:var(--muted);font-size:11px;letter-spacing:1px">STOP TARGETS</div>
      <div>1) <b style="color:var(--red)">${fmt(sl)}</b></div>
      <div style="margin-top:10px;font-size:11px;color:var(--muted)">${new Date(s.signal_time).toLocaleString('en-GB')}</div>`;
  } catch (e2) { box.innerHTML = '<div style="color:var(--muted);text-align:center;padding:18px 0">Signal feed unreachable…</div>'; }
}

function startApp() {
  loadLiveSignal(); setInterval(loadLiveSignal, 30000);
  loadWeekly(); setInterval(loadWeekly, 60000);
  loadSentimentGauge(); setInterval(loadSentimentGauge, 60000);
  loadLoginActivity(); setInterval(loadLoginActivity, 60000);
}

/* --- boot: session check (gate KABHI bypass nahi hota jab key set hai) --- */
(async () => {
  if (ANON_KEY.includes('PASTE_')) { startApp(); return; }          // sirf dev mode (placeholder key)
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('tfx_auth') || 'null'); } catch (e) {}
  if (saved && saved.accessToken) {
    try {
      const r = await fetch(IF_BASE + '/api/auth/sessions/current', {
        headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + saved.accessToken },
      });
      if (r.ok) {
        const d = await r.json();
        const u = d.user || (d.data && d.data.user) || { email: saved.email };
        saveAuth(u, saved.accessToken);
        await onLogin(u);
        return;
      }
    } catch (e) {}
    clearAuth();
  }
  showLogin();
})();
