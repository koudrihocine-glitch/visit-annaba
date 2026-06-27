/**
 * AVRA — Visit Annaba · Proxy OpenAI
 * Route : /api/ai-proxy
 * 
 * La clé OPENAI_API_KEY est stockée dans les variables d'environnement Vercel.
 * Elle n'est jamais exposée au navigateur ni dans le code source.
 */

// Rate limiting simple en mémoire (réinitialisé à chaque cold start Vercel)
const rateMap = new Map();
const RATE_LIMIT = 10;      // requêtes max
const RATE_WINDOW = 60000;  // par 60 secondes

function checkRate(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) {
    rateMap.set(ip, { count: 1, start: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  rateMap.set(ip, entry);
  return true;
}

export default async function handler(req, res) {

  /* ── CORS : autoriser uniquement votre domaine ── */
  const allowed = [
    'https://visitannaba-vr.com',
    'https://algerianvragency.com',
    'https://www.visitannaba-vr.com',
    'http://localhost',
    'null'   // fichiers ouverts localement (tests)
  ];
  const origin = req.headers.origin || '';
  const ok = allowed.some(o => origin.startsWith(o)) || !origin;

  res.setHeader('Access-Control-Allow-Origin',  ok ? (origin || '*') : 'https://visitannaba-vr.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  /* ── Rate limiting par IP ── */
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (!checkRate(ip)) {
    return res.status(429).json({ error: 'Trop de requêtes. Attendez 1 minute.' });
  }

  /* ── Clé OpenAI côté serveur uniquement ── */
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Clé API non configurée. Contactez l\'administrateur.' });
  }

  try {
    const body = req.body;

    /* Sécurité : forcer le modèle autorisé, limiter les tokens */
    const safePayload = {
      model:       'gpt-4o',
      max_tokens:  Math.min(body.max_tokens || 4000, 8000),
      temperature: body.temperature ?? 0.7,
      messages:    body.messages,
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(safePayload),
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (err) {
    console.error('[AVRA Proxy OpenAI]', err.message);
    return res.status(500).json({ error: 'Erreur proxy : ' + err.message });
  }
}
