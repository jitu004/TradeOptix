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

loadWeekly(); setInterval(loadWeekly, 60000);
loadEngineLogs(); setInterval(loadEngineLogs, 3000);
loadSentimentGauge(); setInterval(loadSentimentGauge, 60000);
