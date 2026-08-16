// api/rsvp.js — fonction serverless Vercel
// Reçoit les réponses RSVP du faire-part et les écrit dans Notion.
// Anti-doublon : refuse un second envoi pour le même code foyer.
// Token Notion fourni via variable d'environnement NOTION_API_KEY sur Vercel.

const NOTION_DATABASE_ID = 'eca75fdc-89fa-40b7-a60a-1237c207c915';
const NOTION_DATA_SOURCE_ID = '7c5fb4e1-927f-484a-90b4-3e47e89b3123';

function prop(value) {
  return { rich_text: [{ text: { content: String(value ?? '') } }] };
}
function select(name) {
  return name ? { select: { name } } : { select: null };
}
function multiSelect(names) {
  return { multi_select: (names || []).map((n) => ({ name: n })) };
}
function title(value) {
  return { title: [{ text: { content: String(value ?? 'Invité') } }] };
}

async function alreadyReplied(token, codeFoyer) {
  if (!codeFoyer) return false;
  const r = await fetch(`https://api.notion.com/v1/data_sources/${NOTION_DATA_SOURCE_ID}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: {
        property: 'Code foyer',
        rich_text: { equals: codeFoyer },
      },
    }),
  });
  if (!r.ok) return false; // en cas de doute, on laisse passer (mieux vaut un doublon qu'une perte)
  const data = await r.json();
  return (data.results || data.data || []).length > 0;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Méthode non autorisée' });
  }

  const token = process.env.NOTION_API_KEY;
  if (!token) {
    return res.status(500).json({ ok: false, error: 'NOTION_API_KEY manquant côté serveur' });
  }

  const b = req.body || {};
  const name = b.nom || b.foyer || 'Invité';

  // Anti-doublon : si ce code foyer a déjà répondu, on refuse
  const deja = await alreadyReplied(token, b.codeFoyer);
  if (deja) {
    return res.status(200).json({ ok: true, dejaRepondu: true });
  }

  const properties = {
    Name: title(name),
    Version: select(b.version),
    'Présence': select(b.presence),
    'Accompagné': select(b.accompagne),
    'Conjoint': prop(b.conjoint),
    'Enfants': select(b.enfants),
    'Prénoms enfants': prop(b.prenomsEnfants),
    'Âges enfants': prop(b.agesEnfants),
    'Code foyer': prop(b.codeFoyer),
    'Cérémonies': multiSelect(b.ceremonies),
  };

  try {
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        properties,
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ ok: false, error: 'Notion a refusé', detail: err.slice(0, 400) });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
