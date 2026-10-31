// Vercel Serverless Function: envia eventos para a API de Conversoes da Meta.
// Variaveis de ambiente (painel da Vercel): META_CAPI_TOKEN (obrigatoria),
// META_PIXEL_ID (opcional) e META_TEST_EVENT_CODE (opcional, so para testes).
const PIXEL_ID = process.env.META_PIXEL_ID || "1771306594128256";
const ALLOWED = ["PageView"];

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return res.status(500).json({ error: "missing token" });

  let b = req.body;
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch (e) { b = {}; }
  }
  b = b || {};
  if (!ALLOWED.includes(b.event_name) || !b.event_id) return res.status(400).json({ error: "event" });

  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const user_data = {
    client_ip_address: fwd || req.socket.remoteAddress,
    client_user_agent: req.headers["user-agent"],
  };
  if (b.fbp) user_data.fbp = String(b.fbp).slice(0, 200);
  if (b.fbc) user_data.fbc = String(b.fbc).slice(0, 300);

  const event = {
    event_name: b.event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: String(b.event_id).slice(0, 100),
    event_source_url: String(b.url || req.headers.referer || "").slice(0, 2000),
    action_source: "website",
    user_data,
  };
  const custom = {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((k) => {
    if (b[k]) custom[k] = String(b[k]).slice(0, 200);
  });
  if (Object.keys(custom).length) event.custom_data = custom;

  const payload = { data: [event] };
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;

  try {
    const r = await fetch(
      "https://graph.facebook.com/v21.0/" + PIXEL_ID + "/events?access_token=" + encodeURIComponent(token),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    const out = await r.json().catch(() => ({}));
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, events_received: out.events_received, error: r.ok ? undefined : out.error && out.error.message });
  } catch (e) {
    return res.status(502).json({ error: "meta" });
  }
};
