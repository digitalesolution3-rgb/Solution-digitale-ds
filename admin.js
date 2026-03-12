// api/admin.js — Actions admin (Supabase)
const { getDb, hash, cors, check } = require('./supabase-client');

const ADMIN_TOKEN = process.env.ADMIN_SECRET || 'DIGITALE_ADMIN';

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers['authorization']?.replace('Bearer ', '') || req.body?.token;
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Non autorisé.' });
  }

  const { action } = req.body || req.query;

  try {
    const db = getDb();

    // ── Lister tous les marchands ───────────────────────────────
    if (action === 'list_merchants') {
      const { data, error } = await db
        .from('merchants')
        .select('id,nom_commerce,proprietaire,telephone,ville,type,licence,licence_expiry,actif,plan_type,created_at')
        .order('created_at', { ascending: false });
      check(error, 'Liste marchands');
      return res.status(200).json({ success: true, merchants: data || [] });
    }

    // ── Activer / prolonger abonnement ─────────────────────────
    if (action === 'extend') {
      const { merchant_id, days, plan_type } = req.body;

      const { data: rows, error: e1 } = await db
        .from('merchants').select('licence_expiry').eq('id', merchant_id).limit(1);
      check(e1, 'Lecture marchand');
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'Marchand introuvable.' });

      const base = rows[0].licence_expiry && new Date(rows[0].licence_expiry) > new Date()
        ? new Date(rows[0].licence_expiry) : new Date();
      base.setDate(base.getDate() + parseInt(days));

      const planLabel = plan_type || (days >= 300 ? 'annuel' : days >= 80 ? 'trimestriel' : 'mensuel');

      const { error: e2 } = await db.from('merchants').update({
        licence:        'active',
        actif:          true,
        licence_expiry: base.toISOString(),
        plan_type:      planLabel,
        updated_at:     new Date().toISOString()
      }).eq('id', merchant_id);
      check(e2, 'Extension abonnement');

      return res.status(200).json({ success: true, expiry: base.toISOString() });
    }

    // ── Suspendre / réactiver ──────────────────────────────────
    if (action === 'suspend') {
      const { merchant_id, suspend } = req.body;
      const { error } = await db.from('merchants').update({
        actif:      !suspend,
        licence:    suspend ? 'suspendue' : 'active',
        updated_at: new Date().toISOString()
      }).eq('id', merchant_id);
      check(error, 'Suspension');
      return res.status(200).json({ success: true });
    }

    // ── Sync global localStorage → Supabase ────────────────────
    if (action === 'sync_all') {
      const { data: payload } = req.body;
      const ALLOWED = ['merchants', 'products', 'sales', 'clients', 'configs'];
      const results = {};

      for (const [col, items] of Object.entries(payload || {})) {
        if (!items?.length || !ALLOWED.includes(col)) { results[col] = 0; continue; }
        const CHUNK = 500;
        let saved = 0;
        for (let i = 0; i < items.length; i += CHUNK) {
          const chunk = items.slice(i, i + CHUNK);
          const { error } = await db.from(col).upsert(chunk, { onConflict: 'id' });
          check(error, `sync_all ${col} chunk ${i}`);
          saved += chunk.length;
        }
        results[col] = saved;
      }

      return res.status(200).json({ success: true, results });
    }

    // ── Lister les paiements ────────────────────────────────────
    if (action === 'list_payments') {
      const { data, error } = await db
        .from('payments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      check(error, 'Liste paiements');
      return res.status(200).json({ success: true, payments: data || [] });
    }

    return res.status(400).json({ error: 'Action inconnue: ' + action });

  } catch(e) {
    console.error('Admin error:', e);
    return res.status(500).json({ error: 'Erreur serveur: ' + e.message });
  }
};
