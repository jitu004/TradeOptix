/* TradeOptix — InsForge DB Client
   =================================
   STEP 1: InsForge Dashboard → "API Keys" se apni keys lo
   STEP 2: Neeche 2 values paste karo
   STEP 3: Git push → site auto-update
   (Anon key PUBLIC hai — RLS policies sirf read allow karti hain, safe hai) */

window.INSFORGE_URL = 'https://r3pjdfkc.insforge.site';   // ← apna project URL
window.INSFORGE_ANON_KEY = 'anon_d4e349cf0f19d19a9a53315e4b667de23297b526c873fe3c4702b22792724c8c';                  // ← apni anon/public key

/* --- helper functions (PostgREST style — InsForge compatible) --- */
window.dbGet = async function(table, query) {
  const r = await fetch(`${window.INSFORGE_URL}/rest/v1/${table}?${query||''}`, {
    headers: { 'apikey': window.INSFORGE_ANON_KEY, 'Authorization': `Bearer ${window.INSFORGE_ANON_KEY}` }
  });
  if (!r.ok) throw new Error('dbGet ' + r.status);
  return r.json();
};
window.dbPost = async function(table, row) {
  const r = await fetch(`${window.INSFORGE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'apikey': window.INSFORGE_ANON_KEY, 'Authorization': `Bearer ${window.INSFORGE_ANON_KEY}`,
               'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(row)
  });
  return r.ok;
};
