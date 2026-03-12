// api/register.js — Inscription nouveau marchand (Supabase)
const { getDb, hash, cors, check } = require('./supabase-client');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { nom_commerce, proprietaire, telephone, ville, password, type } = req.body || {};

  if (!nom_commerce || !proprietaire || !telephone || !password) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }

  try {
    const db = getDb();

    // Vérifier si numéro déjà utilisé
    const { data: existing, error: e0 } = await db
      .from('merchants')
      .select('id')
      .eq('telephone', telephone.trim())
      .limit(1);
    check(e0, 'Vérification doublon');

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Ce numéro est déjà utilisé.' });
    }

    const mid = 'merchant_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);

    const merchant = {
      id:             mid,
      nom_commerce:   nom_commerce.trim(),
      proprietaire:   proprietaire.trim(),
      telephone:      telephone.trim(),
      ville:          (ville || '').trim(),
      type:           type || 'boutique',
      password:       hash(password),
      licence:        'active',
      licence_expiry: expiry.toISOString(),
      actif:          true,
      created_at:     new Date().toISOString()
    };

    const config = {
      id:               'cfg_' + mid,
      merchant_id:      mid,
      couleur_theme:    '#E8730C',
      devise:           'FCFA',
      message_accueil:  'Bienvenue chez ' + nom_commerce + ' !',
      wa_message:       'Merci {nom} pour votre achat de {total} chez {commerce} 🙏 Revenez bientôt !',
      pin:              '',
      created_at:       new Date().toISOString()
    };

    const { error: e1 } = await db.from('merchants').insert(merchant);
    check(e1, 'Création marchand');

    const { error: e2 } = await db.from('configs').insert(config);
    check(e2, 'Création config');

    delete merchant.password;

    return res.status(201).json({ success: true, merchant, config });

  } catch(e) {
    console.error('Register error:', e);
    return res.status(500).json({ error: 'Erreur serveur. Réessayez.' });
  }
};
