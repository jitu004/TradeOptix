// TradeOptix — Access Request (signup -> pending approval) — InsForge Edge Function (Deno/TS)
// User signup ke baad ye call hota hai. Request 'pending' me record hoti hai.
// Admin ko Brevo email jata hai jisme 1-CLICK APPROVAL LINK hota hai — login ki zaroorat nahi.

const BASE = Deno.env.get("INSFORGE_URL") ?? "https://r3pjdfkc.eu-central.insforge.app";
const KEY = Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";
const BREVO = Deno.env.get("BREVO_KEY") ?? "";
const HMAC_SECRET = Deno.env.get("JWT_SECRET") ?? Deno.env.get("INSFORGE_SERVICE_KEY") ?? "";
const ADMIN = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function esc(v: string): string { return v.replace(/'/g, "''"); }
function b64u(x: string): string { return btoa(x).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

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

async function signToken(email: string): Promise<string> {
  const payload = b64u(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + 7 * 86400 }));
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(HMAC_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(payload));
  return `${payload}.${b64u(String.fromCharCode(...new Uint8Array(sig)))}`;
}

async function email(to: string, subject: string, text: string): Promise<void> {
  if (!BREVO) return;
  try {
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO, "Content-Type": "application/json" },
      body: JSON.stringify({ sender: { name: "TradeOptix", email: "noreply@tradeoptix.app" }, to: [{ email: to }], subject, textContent: text }),
    });
  } catch { }
}

export default async function handler(req: Request): Promise<Response> {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors });
    const body = await req.json();
    const email_ = String(body.email || "").slice(0, 120);
    const uid = String(body.uid || "").slice(0, 64);
    if (!email_ || !email_.includes("@")) return new Response(JSON.stringify({ error: "valid email required" }), { status: 400, headers: cors });
    await runSql(`INSERT INTO access_requests (email,uid,status) VALUES ('${esc(email_)}','${esc(uid)}','pending') ON CONFLICT (email) DO NOTHING`);
    await runSql(`INSERT INTO engine_logs (level,message) VALUES ('WARN','ACCESS REQUEST: ${esc(email_)} (pending approval)')`);
    if (ADMIN.length) {
      const token = await signToken(email_);
      const link = `https://r3pjdfkc.function2.insforge.app/approve_link?t=${token}`;
      await email(ADMIN[0], "TradeOptix — New Access Request (1-click approve)",
        `New access request from: ${email_}\n\nApprove karne ke liye BAS IS LINK PE CLICK KARO (login ki zaroorat nahi):\n${link}\n\n(Link 7 din valid hai)`);
    }
    return new Response(JSON.stringify({ ok: true, status: "pending" }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
