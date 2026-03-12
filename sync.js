// api/sync.js — Sauvegarde données marchand → Supabase
const { getDb, cors, check } = require('./supabase-client');

const ALLOWED = ['products', 'sales', 'clients', 'configs'];

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { merchant_id, collection: col, items, item, delete: deleteId } = req.body || {};

  if (!merchant_id || !col) {
    return res.status(400).json({ error: 'merchant_id et collection requis.' });
  }
  if (!ALLOWED.includes(col)) {
    return res.status(400).json({ error: 'Collection non autorisée: ' + col });
  }

  try {
    const db = getDb();

    // ── Mode 1 : supprimer un document ──────────────────────────
    if (deleteId) {
      const { error } = await db.from(col).delete().eq('id', deleteId).eq('merchant_id', merchant_id);
      check(error, 'Suppression');
      return res.status(200).json({ success: true, deleted: deleteId });
    }

    // ── Mode 2 : upsert un seul item ────────────────────────────
    if (item) {
      const id = item.id || ('doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
      const { error } = await db.from(col).upsert({ ...item, id, merchant_id }, { onConflict: 'id' });
      check(error, 'Upsert item');
      return res.status(200).json({ success: true, id });
    }

    // ── Mode 3 : upsert batch (array d'items) ───────────────────
    if (items && items.length > 0) {
      const CHUNK = 500; // limite Supabase recommandée
      let saved = 0;

      for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK).map(it => ({
          ...it,
          id: it.id || ('doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
          merchant_id
        }));
        const { error } = await db.from(col).upsert(chunk, { onConflict: 'id' });
        check(error, `Batch upsert chunk ${i}`);
        saved += chunk.length;
      }
      return res.status(200).json({ success: true, saved });
    }

    return res.status(400).json({ error: 'Aucune donnée à synchroniser.' });

  } catch(e) {
    console.error('Sync error:', e);
    return res.status(500).json({ error: 'Erreur sync: ' + e.message });
  }
};
