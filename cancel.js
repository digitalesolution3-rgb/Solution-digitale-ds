// api/cancel.js — Annulation de facture (Supabase)
// ============================================================
// - Marque la vente comme 'annulée' (statut field) sans supprimer
// - Ajuste le total_achats et nb_achats du client si applicable
// - Accessible par le marchand (merchant_id requis) ou l'admin (token requis)
// ============================================================

const { getDb, cors, check } = require('./supabase-client');

const ADMIN_TOKEN = process.env.ADMIN_SECRET || 'DIGITALE_ADMIN';

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { sale_id, merchant_id, raison } = req.body || {};

  if (!sale_id) {
    return res.status(400).json({ error: 'sale_id requis.' });
  }

  // Vérifier l'identité : marchand OU admin
  const adminToken = req.headers['authorization']?.replace('Bearer ', '') || req.body?.token;
  const isAdmin    = adminToken === ADMIN_TOKEN;
  const isMerchant = !!merchant_id;

  if (!isAdmin && !isMerchant) {
    return res.status(401).json({ error: 'merchant_id ou token admin requis.' });
  }

  try {
    const db = getDb();

    // ── 1. Récupérer la vente ──────────────────────────────────
    const { data: sales, error: e1 } = await db
      .from('sales')
      .select('*')
      .eq('id', sale_id)
      .limit(1);
    check(e1, 'Lecture vente');

    if (!sales || sales.length === 0) {
      return res.status(404).json({ error: 'Vente introuvable.' });
    }

    const sale = sales[0];

    // Un marchand ne peut annuler que ses propres ventes
    if (isMerchant && !isAdmin && sale.merchant_id !== merchant_id) {
      return res.status(403).json({ error: 'Cette vente n\'appartient pas à votre compte.' });
    }

    // Vérifier que la vente n'est pas déjà annulée
    if (sale.statut === 'annulée') {
      return res.status(409).json({ error: 'Cette vente est déjà annulée.' });
    }

    // ── 2. Marquer la vente comme annulée ─────────────────────
    const { error: e2 } = await db
      .from('sales')
      .update({
        statut:       'annulée',
        raison_annulation: raison || null,
        annulée_at:   new Date().toISOString(),
        annulée_par:  isAdmin ? 'admin' : 'marchand'
      })
      .eq('id', sale_id);
    check(e2, 'Annulation vente');

    // ── 3. Ajuster le client si applicable ────────────────────
    let clientUpdated = false;

    if (sale.client_id) {
      const { data: clients, error: e3 } = await db
        .from('clients')
        .select('total_achats, nb_achats')
        .eq('id', sale.client_id)
        .limit(1);
      check(e3, 'Lecture client');

      if (clients && clients.length > 0) {
        const client = clients[0];
        const newTotal = Math.max(0, (client.total_achats || 0) - (sale.total || 0));
        const newNb    = Math.max(0, (client.nb_achats    || 0) - 1);

        const { error: e4 } = await db
          .from('clients')
          .update({
            total_achats: newTotal,
            nb_achats:    newNb
          })
          .eq('id', sale.client_id);
        check(e4, 'Mise à jour client');
        clientUpdated = true;
      }
    }

    console.log(`[Cancel] ✅ Vente ${sale_id} annulée par ${isAdmin ? 'admin' : 'marchand ' + merchant_id}`);

    return res.status(200).json({
      success:        true,
      sale_id,
      statut:         'annulée',
      client_updated: clientUpdated,
      message:        `Vente annulée avec succès.${clientUpdated ? ' Historique client mis à jour.' : ''}`
    });

  } catch(e) {
    console.error('Cancel error:', e);
    return res.status(500).json({ error: 'Erreur serveur: ' + e.message });
  }
};
