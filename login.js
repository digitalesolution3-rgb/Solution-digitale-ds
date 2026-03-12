// api/login.js — Connexion marchand (Supabase)
const { getDb, hash, cors, check } = require('./supabase-client');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { telephone, password } = req.body || {};
  if (!telephone || !password) {
    return res.status(400).json({ error: 'Téléphone et mot de passe requis.' });
  }

  try {
    const db = getDb();

    const { data: merchants, error: err1 } = await db
      .from('merchants')
      .select('*')
      .eq('telephone', telephone.trim())
      .limit(1);
    check(err1, 'Recherche marchand');

    if (!merchants || merchants.length === 0) {
      return res.status(401).json({ error: 'Compte introuvable. Vérifiez votre numéro.' });
    }

    const merchant = merchants[0];

    if (merchant.password !== hash(password)) {
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }

    if (merchant.actif === false) {
      return res.status(403).json({ error: 'Compte désactivé. Contactez l\'administrateur.' });
    }

    const mid = merchant.id;

    const [
      { data: products, error: e1 },
      { data: sales,    error: e2 },
      { data: clients,  error: e3 },
      { data: configs,  error: e4 },
    ] = await Promise.all([
      db.from('products').select('*').eq('merchant_id', mid),
      db.from('sales').select('*').eq('merchant_id', mid),
      db.from('clients').select('*').eq('merchant_id', mid),
      db.from('configs').select('*').eq('merchant_id', mid),
    ]);

    check(e1, 'products'); check(e2, 'sales'); check(e3, 'clients'); check(e4, 'configs');

    delete merchant.password;

    return res.status(200).json({
      success: true,
      merchant,
      data: {
        products: products || [],
        sales:    sales    || [],
        clients:  clients  || [],
        configs:  configs  || [],
      }
    });

  } catch(e) {
    console.error('Login error:', e);
    return res.status(500).json({ error: 'Erreur serveur. Réessayez.' });
  }
};
