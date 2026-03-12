// api/notifications.js — Lire / marquer comme lues les notifications
// ============================================================

const { getDb, cors, check } = require('./supabase-client');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDb();

  try {
    // ── GET : récupérer les notifications du marchand ──────────
    if (req.method === 'GET') {
      const { merchant_id, unread_only } = req.query;
      if (!merchant_id) return res.status(400).json({ error: 'merchant_id requis.' });

      let query = db
        .from('notifications')
        .select('*')
        .eq('merchant_id', merchant_id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (unread_only === 'true') query = query.eq('lu', false);

      const { data, error } = await query;
      check(error, 'Lecture notifications');

      const unreadCount = (data || []).filter(n => !n.lu).length;

      return res.status(200).json({
        success:       true,
        notifications: data || [],
        unread_count:  unreadCount
      });
    }

    // ── POST : marquer comme lues ──────────────────────────────
    if (req.method === 'POST') {
      const { merchant_id, notif_ids, mark_all } = req.body || {};
      if (!merchant_id) return res.status(400).json({ error: 'merchant_id requis.' });

      if (mark_all) {
        // Tout marquer comme lu
        const { error } = await db
          .from('notifications')
          .update({ lu: true })
          .eq('merchant_id', merchant_id)
          .eq('lu', false);
        check(error, 'Marquer tout comme lu');
        return res.status(200).json({ success: true, action: 'all_marked_read' });
      }

      if (notif_ids?.length > 0) {
        // Marquer des notifs spécifiques
        const { error } = await db
          .from('notifications')
          .update({ lu: true })
          .in('id', notif_ids)
          .eq('merchant_id', merchant_id);
        check(error, 'Marquer notifs comme lues');
        return res.status(200).json({ success: true, action: 'marked_read', count: notif_ids.length });
      }

      return res.status(400).json({ error: 'notif_ids ou mark_all requis.' });
    }

    // ── DELETE : supprimer les notifs lues ─────────────────────
    if (req.method === 'DELETE') {
      const { merchant_id } = req.body || req.query;
      if (!merchant_id) return res.status(400).json({ error: 'merchant_id requis.' });

      const { error } = await db
        .from('notifications')
        .delete()
        .eq('merchant_id', merchant_id)
        .eq('lu', true);
      check(error, 'Suppression notifs lues');
      return res.status(200).json({ success: true, action: 'read_deleted' });
    }

    return res.status(405).json({ error: 'Méthode non autorisée' });

  } catch(e) {
    console.error('Notifications error:', e);
    return res.status(500).json({ error: 'Erreur serveur: ' + e.message });
  }
};
