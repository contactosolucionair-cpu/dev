/**
 * GET /api/get-config
 *
 * Fetches system config from Supabase 'site_config' table (id='global').
 * Structure: { colors: {}, feature_flags: {}, translations: { es: {}, en: {} } }
 * Returns hardcoded defaults if table/row doesn't exist.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  var SB_URL = process.env.SUPABASE_URL;
  var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  var defaults = {
    colors: {
      primary: '#D4A853',
      secondary: '#2D4A3E',
      bg: '#F7F5F0',
      text: '#111111',
    },
    feature_flags: {
      ai_extraction: true,
      ai_success_pct: true,
    },
    translations: {
      es: {
        hero_title: 'Compensaciones aéreas. Tu vuelo falló. Nosotros reclamamos por vos.',
        hero_sub: 'Gestionamos reclamos por vuelos demorados, cancelados, sobreventa o problemas con equipaje. Sin costo inicial: cobramos solo si conseguís compensación.',
        cta_text: 'Iniciá tu reclamo gratis',
        form_title: 'Comenzá tu reclamo',
      },
      en: {
        hero_title: 'Flight compensation. Your flight failed. We claim for you.',
        hero_sub: 'We manage claims for delayed, cancelled or overbooked flights and baggage issues. No upfront cost: we only charge if you get compensation.',
        cta_text: 'Start your free claim',
        form_title: 'Start your claim',
      },
    },
  };

  if (!SB_URL || !SB_KEY) return res.status(200).json({ success: true, config: defaults });

  try {
    var sbRes = await fetch(SB_URL + '/rest/v1/site_config?id=eq.global&select=*&limit=1', {
      method: 'GET',
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
    });

    if (!sbRes.ok) return res.status(200).json({ success: true, config: defaults });

    var rows = JSON.parse(await sbRes.text());
    if (!rows.length) return res.status(200).json({ success: true, config: defaults });

    var row = rows[0];

    var config = {
      colors: row.colors || defaults.colors,
      feature_flags: row.feature_flags || defaults.feature_flags,
      translations: {
        es: (row.translations && row.translations.es) || defaults.translations.es,
        en: (row.translations && row.translations.en) || defaults.translations.en,
      },
    };

    return res.status(200).json({ success: true, config: config });
  } catch (err) {
    return res.status(200).json({ success: true, config: defaults });
  }
}
