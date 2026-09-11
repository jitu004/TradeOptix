// TradeOptix — Approve User (ADMIN only) — InsForge Edge Function (Deno/TS)
// Approve from admin panel -> Brevo email to user -> user can login.
// Token verify via InsForge /api/auth/sessions/current.
const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";
const ANON = Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? "";
const BREVO = Deno.env.get("BREVO_KEY") ?? "";
const ADMIN = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function esc(v: string): string { return v.replace(/'/g, "''"); }

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

async function getUserByToken(token: string): Promise<any | null> {
  if (!token || !ANON) return null;
  try {
    const r = await fetch(`${BASE}/api/auth/sessions/current`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.user || (d.data && d.data.user) || (d.email ? d : null);
  } catch { return null; }
}

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!BREVO) return false;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "TradeOptix", email: "noreply@tradeoptix.app" },
        to: [{ email: to }], subject, textContent: text,
      }),
    });
    return r.ok;
  } catch { return false; }
}

export default async function handler(req: Request): Promise<Response> {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors });
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const user = await getUserByToken(token);
    const admin = String((user && user.email) || "").toLowerCase();
    if (!admin || !ADMIN.includes(admin)) return new Response(JSON.stringify({ error: "admin only" }), { status: 403, headers: cors });
    const body = await req.json();
    const target = String(body.email || "").toLowerCase().slice(0, 120);
    if (!target.includes("@")) return new Response(JSON.stringify({ error: "bad email" }), { status: 400, headers: cors });
    await runSql(`UPDATE access_requests SET status='approved', approved_at=now(), approved_by='${esc(admin)}' WHERE email='${esc(target)}'`);
    const mailed = await sendEmail(target, "TradeOptix — Access Approved ✅",
      `Hello,\n\nAapki TradeOptix access request APPROVE ho gayi hai.\n\nLogin karo: https://r3pjdfkc.insforge.site\n\n— TradeOptix Admin`);
    await runSql(`INSERT INTO engine_logs (level,message) VALUES ('INFO','APPROVED: ${esc(target)} by ${esc(admin)}${mailed ? " (email sent)" : ""}')`);
    return new Response(JSON.stringify({ ok: true, email_sent: mailed }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
