"""
TradeOptix — Public Signals Feed (InsForge Function)
====================================================
Deploy this in InsForge Dashboard → Functions → New Function → Python.
Make it PUBLIC (no auth) — it only READS signals and returns JSON.
All secrets stay server-side (env vars). The app has ZERO keys.

Env vars needed (set in InsForge dashboard):
  INSFORGE_URL          e.g. https://r3pjdfkc.insforge.site
  INSFORGE_SERVICE_KEY  your service_role key (server-side only!)

The app fetches:  GET /api/signals
"""

import os, json, urllib.request

def _query():
    base = os.environ.get("INSFORGE_URL", "https://r3pjdfkc.insforge.site").rstrip("/")
    key = os.environ["INSFORGE_SERVICE_KEY"]
    url = f"{base}/rest/v1/signals?select=*&order=signal_time.desc&limit=20"
    req = urllib.request.Request(url, headers={
        "apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def handler(request):
    """Adjust the signature to InsForge's Python function format if different."""
    try:
        rows = _query()
    except Exception as e:
        return {"statusCode": 502,
                "headers": {"Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"error": str(e)})}
    return {"statusCode": 200,
            "headers": {"Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*",
                        "Cache-Control": "public, max-age=60"},
            "body": json.dumps(rows)}
