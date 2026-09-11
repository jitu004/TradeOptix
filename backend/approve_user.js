// TradeOptix — Approve User — ADMIN only (JWT verify local) + Brevo approval email.
const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";
const JWT_PUB = Deno.env.get("JWT_PUBLIC_KEY") ?? "";
const BREVO = Deno.env.get("BREVO_KEY") ?? "";
const ADMIN = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function esc(v) { return v.replace(/'/g, "''"); }
function b64u(x) { return Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)); }

async function runSql(sql) {
  const r = await fetch(`${BASE}/api/database/advance/rawsql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`SQL API ${r.status}`);
  const raw = await r.json();
  return raw.rows ?? raw.data ?? [];
}

async function verifyJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64u(parts[1])));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    if (JWT_PUB) {
      try {
        const der = b64u(JWT_PUB.replace(/-----[^-]+-----|\s+/g, ""));
        const key = await crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
        const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
        if (!ok) return null;
      } catch (e) {}
    }
    return payload;
  } catch (e) { return null; }
}

async function sendEmail(to, subject, text) {
  if (!BREVO) return false;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO, "Content-Type": "application/json" },
      body: JSON.stringify({ sender: { name: "TradeOptix", email: "noreply@tradeoptix.app" }, to: [{ email: to }], subject, textContent: text }),
    });
    return r.ok;
  } catch (e) { return false; }
}

export default async function handler(req) {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors });
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const payload = await verifyJwt(token);
    const admin = String((payload && (payload.email || payload.user_email)) || "").toLowerCase();
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
