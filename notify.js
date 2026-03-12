// api/notify.js — Créer une notification (ajout produit par employé)
// ============================================================
// Appelé automatiquement par le frontend quand un employé ajoute un produit.
// Enregistre la notif en DB + envoie un push PWA si une souscription existe.
// ============================================================

const { getDb, cors, check } = require('./supabase-client');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { merchant_id, product } = req.body || {};

  if (!merchant_id || !product?.nom) {
    return res.status(400).json({ error: 'merchant_id et product.nom requis.' });
  }

  try {
    const db = getDb();

    // ── 1. Enregistrer la notification en base ─────────────────
    const notifId = 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const titre   = '🆕 Nouveau produit ajouté';
    const message = `${product.nom} — ${Number(product.prix || 0).toLocaleString('fr')} FCFA — Stock : ${product.stock || 0}`;

    const { error: e1 } = await db.from('notifications').insert({
      id:          notifId,
      merchant_id,
      type:        'product_added',
      titre,
      message,
      data: {
        product_id: product.id   || null,
        nom:        product.nom,
        prix:       product.prix  || 0,
        stock:      product.stock || 0,
      },
      lu:         false,
      created_at: new Date().toISOString()
    });
    check(e1, 'Insertion notification');

    // ── 2. Envoyer un push PWA si souscription enregistrée ─────
    let pushSent = false;
    const { data: subs, error: e2 } = await db
      .from('push_subscriptions')
      .select('*')
      .eq('merchant_id', merchant_id);

    if (!e2 && subs && subs.length > 0) {
      // Envoyer le push à toutes les souscriptions du marchand
      const pushPromises = subs.map(sub => sendPush(sub, { titre, message, data: { product } }));
      const results = await Promise.allSettled(pushPromises);
      pushSent = results.some(r => r.status === 'fulfilled');

      // Nettoyer les souscriptions expirées (410 Gone)
      const expiredEndpoints = results
        .map((r, i) => r.status === 'rejected' && r.reason?.expired ? subs[i].endpoint : null)
        .filter(Boolean);
      if (expiredEndpoints.length > 0) {
        await db.from('push_subscriptions').delete().in('endpoint', expiredEndpoints);
      }
    }

    console.log(`[Notify] ✅ Notif créée pour ${merchant_id} — push: ${pushSent}`);

    return res.status(201).json({
      success:   true,
      notif_id:  notifId,
      push_sent: pushSent
    });

  } catch(e) {
    console.error('Notify error:', e);
    return res.status(500).json({ error: 'Erreur serveur: ' + e.message });
  }
};

// ── Envoi Push Web (Web Push Protocol sans lib externe) ───────
async function sendPush(sub, payload) {
  // Note : Pour la production, utiliser la lib 'web-push' avec des clés VAPID.
  // Ici on envoie une requête directe à l'endpoint du navigateur.
  try {
    const body = JSON.stringify(payload);
    const response = await fetch(sub.endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'TTL': '86400' },
      body
    });
    if (response.status === 410) {
      const err = new Error('Souscription expirée');
      err.expired = true;
      throw err;
    }
    return response.ok;
  } catch(e) {
    throw e;
  }
}
