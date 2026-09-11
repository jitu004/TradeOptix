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

/* --- Signals History: TRUE ✅ / FALSE ❌ badges ke saath --- */
async function loadDbSignals() {
  const st = document.getElementById('dbStatus'), list = document.getElementById('dbSignals');
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
    list.innerHTML = rows.map(s => {
      const d = new Date(s.signal_time || Date.now());
      return `<div class="trade-row"><span style="color:${s.direction === 1 ? 'var(--green)' : 'var(--red)'}">${s.direction === 1 ? 'LONG' : 'SHORT'}</span>
      <span>${String(s.symbol).replace('USDT', '')}</span><span>@ ${fmt(+s.entry_price)}</span>
      <span style="color:var(--muted)">${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="badge ${s.timeframe === '4h' ? 'badge-mid' : 'badge-strong'}">${(s.timeframe || '').toUpperCase()}${s.tier > 1 ? ' T' + s.tier : ''}</span>${badge(s)}</div>`;
    }).join('');
  } catch (e) { st.textContent = 'Feed unreachable — v4 functions deploy karo (README v4 section).'; }
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
  } catch (e) { el.innerHTML = '<div class="note">Weekly API not deployed yet — backend/public_weekly.js deploy karo.</div>'; }
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
  } catch (e) { el.innerHTML = '<div class="note">Sentiment engine not deployed yet — backend/market_sentiment.js deploy karo (schedule: 15 min, public ON).</div>'; }
}

/* ================= AUTH GATE + LOGIN ACTIVITY =================
   InsForge Auth (Supabase-compatible) — bina login ke site ka content nahi dikhta.
   ANON_KEY: Dashboard -> Secrets -> INSFORGE_ANON_KEY ki value yahan paste karo.
   (Anon key browser me safe hoti hai — ye public key hi hoti hai.) */
const ANON_KEY = 'anon_d4e349cf0f19d19a9a53315e4b667de23297b526c873fe3c4702b22792724c8c';
const sb = (window.supabase && !ANON_KEY.includes('PASTE_'))
  ? window.supabase.createClient('https://r3pjdfkc.eu-central.insforge.app', ANON_KEY)
  : null;
let authToken = null;
const ADMIN_EMAIL = 'j.nagarkoti@outlook.com';   // Secrets ke ADMIN_EMAILS se match hona chahiye (aapka email)

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

function lockApp() {
  document.documentElement.style.overflow = 'hidden';
  for (const el of document.body.children) {
    if (el.id !== 'authGate') el.style.visibility = 'hidden';
  }
}

function unlockApp() {
  document.documentElement.style.overflow = '';
  for (const el of document.body.children) el.style.visibility = '';
}

function showLogin(msg, mode) {
  lockApp();
  document.getElementById('authGate')?.remove();
  const isReq = mode === 'request';
  document.body.insertAdjacentHTML('beforeend', `
  <div id="authGate" style="position:fixed;inset:0;z-index:9999;background:#0b0e11;display:flex;align-items:center;justify-content:center;font-family:inherit">
    <div style="background:#161b22;border:1px solid #30363d;border-radius:14px;padding:32px 36px;width:360px;color:#e6edf3">
      <div style="font-size:22px;font-weight:800;margin-bottom:4px">⚡ TRADE<span style="color:#f0b90b">OPTIX</span></div>
      <div style="font-size:12px;color:#8b949e;margin-bottom:16px">${isReq ? 'Request access — admin approval ke baad login milega' : 'Private access — sign in to continue'}</div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button id="tabIn" style="flex:1;padding:7px;border-radius:7px;border:1px solid #30363d;background:${isReq ? '#0d1117' : '#f0b90b'};color:${isReq ? '#e6edf3' : '#000'};font-weight:700;font-size:12px;cursor:pointer">Sign In</button>
        <button id="tabReq" style="flex:1;padding:7px;border-radius:7px;border:1px solid #30363d;background:${isReq ? '#f0b90b' : '#0d1117'};color:${isReq ? '#000' : '#e6edf3'};font-weight:700;font-size:12px;cursor:pointer">Request Access</button>
      </div>
      <input id="lgEmail" type="email" placeholder="Email" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:10px 12px;border-radius:8px;margin-bottom:10px;font-size:14px">
      <input id="lgPass" type="password" placeholder="Password (min 6 chars)" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:14px">
      <button id="lgBtn" style="width:100%;background:#f0b90b;border:none;color:#000;font-weight:800;padding:11px;border-radius:8px;font-size:14px;cursor:pointer">${isReq ? 'Submit Request' : 'Sign In'}</button>
      <div id="lgMsg" style="font-size:12px;color:#f85149;margin-top:10px;min-height:16px">${msg || ''}</div>
      <div style="font-size:11px;color:#8b949e;margin-top:14px;border-top:1px solid #30363d;padding-top:10px">${isReq ? 'Request submit hone ke baad admin approve karega — approval email aayega.' : 'Access sirf admin-approved accounts ka hai. Naya account? "Request Access" tab dabao.'}</div>
    </div>
  </div>`);
  document.getElementById('tabIn').onclick = () => showLogin('', 'signin');
  document.getElementById('tabReq').onclick = () => showLogin('', 'request');
  const go = async () => {
    const b = document.getElementById('lgBtn'), m = document.getElementById('lgMsg');
    const em = document.getElementById('lgEmail').value.trim();
    const pw = document.getElementById('lgPass').value;
    b.textContent = isReq ? 'Submitting…' : 'Signing in…'; b.disabled = true; m.textContent = '';
    if (isReq) {
      const { data, error } = await sb.auth.signUp({ email: em, password: pw });
      if (error) { m.textContent = error.message; b.textContent = 'Submit Request'; b.disabled = false; return; }
      await submitAccessRequest(em, data.user?.id || '');
      await sb.auth.signOut();
      showLogin('✅ Request submitted! Jab admin approve karega tab email aayega. Tab tak login blocked hai.', 'signin');
      return;
    }
    const { data, error } = await sb.auth.signInWithPassword({ email: em, password: pw });
    if (error) { m.textContent = error.message; b.textContent = 'Sign In'; b.disabled = false; return; }
    const ok = await checkApproval(em.toLowerCase());
    if (!ok) {
      await sb.auth.signOut();
      showLogin('⏳ Aapki access request abhi PENDING hai. Admin approve karega tab email aayega.', 'signin');
      return;
    }
    await onLogin(data.session);
  };
  document.getElementById('lgBtn').onclick = go;
  document.getElementById('lgPass').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}

async function recordLogin(email, uid) {
  try {
    await fetch(SV_BASE + '/log_login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, uid }),
    });
  } catch (e) { /* login record fail = non-fatal */ }
}

async function onLogin(session) {
  authToken = session.access_token;
  await recordLogin(session.user.email, session.user.id);
  document.getElementById('authGate')?.remove();
  unlockApp();
  addLogoutBtn(session.user.email);
  startApp();
}

function addLogoutBtn(email) {
  const h = document.querySelector('header .hdr-right, header div:last-child, header');
  if (!h || document.getElementById('lgOut')) return;
  h.insertAdjacentHTML('beforeend',
    `<span id="lgUser" style="font-size:11px;color:#8b949e;margin-left:8px">${email}</span>
     <button id="lgOut" style="background:#21262d;border:1px solid #30363d;color:#e6edf3;padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer;margin-left:6px">Logout</button>`);
  document.getElementById('lgOut').onclick = async () => { await sb.auth.signOut(); location.reload(); };
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
  } catch (e) { el.innerHTML = '<div class="note">Login history sirf logged-in users ko milti hai.</div>'; }
}

/* --- Access Requests panel (sirf admin ko dikhta hai) --- */
async function loadAccessRequests() {
  const el = document.getElementById('reqList');
  if (!el || !authToken) return;
  const me = (sb && (await sb.auth.getUser())?.data?.user?.email || '').toLowerCase();
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
  } catch (e) { el.innerHTML = '<div class="note">Requests load nahi hui.</div>'; }
}

function startApp() {
  loadWeekly(); setInterval(loadWeekly, 60000);
  loadEngineLogs(); setInterval(loadEngineLogs, 3000);
  loadSentimentGauge(); setInterval(loadSentimentGauge, 60000);
  loadLoginActivity(); setInterval(loadLoginActivity, 60000);
  loadAccessRequests(); setInterval(loadAccessRequests, 30000);
}

/* --- boot: session check --- */
(async () => {
  if (!sb) {
    if (!ANON_KEY.includes('PASTE_')) {
      // ANON_KEY set hai par auth library load nahi hui — gate KABHI bypass nahi hoga
      lockApp();
      document.body.insertAdjacentHTML('beforeend', `
      <div style="position:fixed;inset:0;z-index:9999;background:#0b0e11;display:flex;align-items:center;justify-content:center">
        <div style="background:#161b22;border:1px solid #30363d;border-radius:14px;padding:32px 36px;width:360px;color:#e6edf3;text-align:center">
          <div style="font-size:20px;font-weight:800;margin-bottom:8px">⚠️ Auth library load nahi hui</div>
          <div style="font-size:12px;color:#8b949e;margin-bottom:16px">Network/ad-blocker ne CDN block kiya hai. Page refresh karo ya ad-blocker band karo.</div>
          <button onclick="location.reload()" style="background:#f0b90b;border:none;color:#000;font-weight:800;padding:10px 24px;border-radius:8px;cursor:pointer">Retry</button>
        </div>
      </div>`);
      return;
    }
    startApp(); return;                                 // sirf dev mode (placeholder key) me gate skip
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    const ok = await checkApproval(String(session.user.email).toLowerCase());
    if (ok) { await onLogin(session); }
    else { await sb.auth.signOut(); showLogin('⏳ Access pending admin approval.', 'signin'); }
  }
  else showLogin();
})();
