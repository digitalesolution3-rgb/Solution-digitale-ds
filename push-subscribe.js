// api/push-subscribe.js — Enregistrer une souscription Push PWA
// ============================================================

const { getDb, cors, check } = require('./supabase-client');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDb();

  try {
    // ── POST : enregistrer une souscription ────────────────────
    if (req.method === 'POST') {
      const { merchant_id, subscription } = req.body || {};
      if (!merchant_id || !subscription?.endpoint) {
        return res.status(400).json({ error: 'merchant_id et subscription requis.' });
      }

      const subId = 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const { error } = await db.from('push_subscriptions').upsert({
        id:          subId,
        merchant_id,
        endpoint:    subscription.endpoint,
        p256dh:      subscription.keys?.p256dh || '',
        auth:        subscription.keys?.auth   || '',
        created_at:  new Date().toISOString()
      }, { onConflict: 'endpoint' });
      check(error, 'Enregistrement souscription push');

      return res.status(201).json({ success: true, message: 'Notifications push activées.' });
    }

    // ── DELETE : désabonner ────────────────────────────────────
    if (req.method === 'DELETE') {
      const { merchant_id, endpoint } = req.body || {};
      if (!merchant_id || !endpoint) {
        return res.status(400).json({ error: 'merchant_id et endpoint requis.' });
      }

      const { error } = await db
        .from('push_subscriptions')
        .delete()
        .eq('merchant_id', merchant_id)
        .eq('endpoint', endpoint);
      check(error, 'Suppression souscription push');

      return res.status(200).json({ success: true, message: 'Notifications push désactivées.' });
    }

    return res.status(405).json({ error: 'Méthode non autorisée' });

  } catch(e) {
    console.error('Push subscribe error:', e);
    return res.status(500).json({ error: 'Erreur serveur: ' + e.message });
  }
};
