// Vercel Serverless Function: envia eventos para a API de Conversoes da Meta.
// Variaveis de ambiente (painel da Vercel): META_CAPI_TOKEN (obrigatoria),
// META_PIXEL_ID (opcional) e META_TEST_EVENT_CODE (opcional, so para testes).
const crypto = require("crypto");
const PIXEL_ID = process.env.META_PIXEL_ID || "1771306594128256";
const ALLOWED = ["PageView"];

const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
// normalizacao pedida pela Meta antes do hash: minusculas, sem acentos, espacos e pontuacao
const clean = (v) => {
  try { v = decodeURIComponent(String(v || "")); } catch (e) { v = String(v || ""); }
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
};
const hdr = (req, k) => req.headers[k] || "";

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

  const fwd = String(hdr(req, "x-forwarded-for")).split(",")[0].trim();
  const user_data = {
    client_ip_address: String(hdr(req, "x-real-ip") || fwd || req.socket.remoteAddress || ""),
    client_user_agent: hdr(req, "user-agent"),
  };
  if (b.fbp) user_data.fbp = String(b.fbp).slice(0, 200);
  if (b.fbc) user_data.fbc = String(b.fbc).slice(0, 300);
  if (b.external_id) user_data.external_id = [sha(String(b.external_id).slice(0, 100))];

  // localizacao (pela geolocalizacao de IP da Vercel), com hash SHA-256
  const city = clean(hdr(req, "x-vercel-ip-city"));
  const region = clean(hdr(req, "x-vercel-ip-country-region"));
  const country = clean(hdr(req, "x-vercel-ip-country"));
  const zip = clean(hdr(req, "x-vercel-ip-postal-code"));
  if (city) user_data.ct = [sha(city)];
  if (region) user_data.st = [sha(region)];
  if (country) user_data.country = [sha(country)];
  if (zip) user_data.zp = [sha(zip)];

  const event = {
    event_name: b.event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: String(b.event_id).slice(0, 100),
    event_source_url: String(b.url || hdr(req, "referer") || "").slice(0, 2000),
    action_source: "website",
    user_data,
  };
  const custom = {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((k) => {
    if (b[k]) custom[k] = String(b[k]).slice(0, 200);
  });
  if (b.referrer) custom.referrer = String(b.referrer).slice(0, 500);
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
