// TradeOptix — 1-Click Email Approval — InsForge Edge Function (Deno/TS)
// The "Approve" link in the admin's approval email — one click = user approved.
// Token: HMAC-SHA256 signed {email, exp} — signed with the JWT_SECRET secret.
// No login required — just click the link.

const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";
const HMAC_SECRET = Deno.env.get("JWT_SECRET") ?? Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";
const BREVO = Deno.env.get("BREVO_KEY") ?? "";

function esc(v: string): string { return v.replace(/'/g, "''"); }

function b64u(x: string): string {
  return btoa(x).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function ub64(x: string): string {
  return atob(x.replace(/-/g, "+").replace(/_/g, "/"));
}

async function hmac(data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(HMAC_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return b64u(String.fromCharCode(...new Uint8Array(sig)));
}

async function runSql(sql: string): Promise<any[]> {
  const r = await fetch(`${BASE}/api/database/advance/rawsql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`SQL API ${r.status}`);
  const raw = await r.json();
  return raw.rows ?? raw.data ?? [];
}

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!BREVO) return false;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO, "Content-Type": "application/json" },
      body: JSON.stringify({ sender: { name: "TradeOptix", email: "noreply@tradeoptix.app" }, to: [{ email: to }], subject, textContent: text }),
    });
    return r.ok;
  } catch { return false; }
}

function page(html: string): Response {
  return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TradeOptix Approval</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0e11;font-family:-apple-system,Segoe UI,sans-serif}
.card{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:40px 44px;max-width:420px;color:#e6edf3;text-align:center}
.big{font-size:52px;margin-bottom:8px}.msg{font-size:15px;line-height:1.6;color:#c9d1d9}
@keyframes run{0%{transform:translateX(-24px)}100%{transform:translateX(24px)}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.run{display:inline-block;animation:run 1.1s ease-in-out infinite alternate}
.bob{display:inline-block;animation:bob 1s ease-in-out infinite}
.btn{display:inline-block;margin-top:18px;background:#f0b90b;color:#000;font-weight:800;padding:11px 26px;border-radius:8px;text-decoration:none}
</style></head><body><div class="card">${html}</div></body></html>`, { status: 200, headers: { "Content-Type": "text/html" } });
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const t = new URL(req.url).searchParams.get("t") || "";
    const dot = t.lastIndexOf(".");
    if (dot < 1) return page(`<div class="big">❌</div><div class="msg">Invalid approval link.</div>`);
    const payloadB64 = t.slice(0, dot), sig = t.slice(dot + 1);
    const expect = await hmac(payloadB64);
    if (sig !== expect) return page(`<div class="big">❌</div><div class="msg">Invalid or tampered link.</div>`);
    const payload = JSON.parse(ub64(payloadB64));
    if (payload.exp && payload.exp * 1000 < Date.now()) return page(`<div class="big">⌛</div><div class="msg">Link expired. Ask the user to request access again.</div>`);
    const email = String(payload.email || "").toLowerCase();
    if (!email.includes("@")) return page(`<div class="big">❌</div><div class="msg">Bad link payload.</div>`);
    const rows = await runSql(`UPDATE access_requests SET status='approved', approved_at=now(), approved_by='email-link' WHERE email='${esc(email)}' RETURNING status`);
    if (!rows.length) await runSql(`INSERT INTO access_requests (email,uid,status,approved_at,approved_by) VALUES ('${esc(email)}','','approved',now(),'email-link') ON CONFLICT (email) DO UPDATE SET status='approved', approved_at=now(), approved_by='email-link'`);
    const mailed = await sendEmail(email, "TradeOptix — Access Approved ✅",
      `Hello,\n\nGood news! Aapki TradeOptix access request APPROVE ho gayi hai.\n\nLogin karo: https://r3pjdfkc.insforge.site\n\n— TradeOptix Admin`);
    await runSql(`INSERT INTO engine_logs (level,message) VALUES ('INFO','APPROVED via email link: ${esc(email)}${mailed ? " (email sent)" : ""}')`);
    return page(`<div class="big">✅</div><div class="msg"><b>${email}</b> has been approved.${mailed ? "<br>Approval email sent to the user." : ""}</div>
      <div style="margin-top:16px;font-size:30px"><span class="run">🏃‍♂️💨</span> <span class="bob">🎉</span> <span class="bob" style="animation-delay:.4s">🎊</span></div>
      <a class="btn" href="https://r3pjdfkc.insforge.site">Open TradeOptix</a>`);
  } catch (e) {
    return page(`<div class="big">⚠️</div><div class="msg">Error: ${String(e).slice(0, 200)}</div>`);
  }
}
