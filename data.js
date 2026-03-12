// api/data.js — Chargement données marchand (Supabase)
const { getDb, cors, check } = require('./supabase-client');

const ALLOWED = ['products', 'sales', 'clients', 'configs'];

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { merchant_id, collection: col } = req.query;

  if (!merchant_id) {
    return res.status(400).json({ error: 'merchant_id requis.' });
  }

  try {
    const db = getDb();

    // Charger une collection spécifique
    if (col) {
      if (!ALLOWED.includes(col)) {
        return res.status(400).json({ error: 'Collection non autorisée.' });
      }
      const { data, error } = await db.from(col).select('*').eq('merchant_id', merchant_id);
      check(error, 'Chargement ' + col);
      return res.status(200).json({ success: true, items: data || [] });
    }

    // Charger toutes les collections en parallèle
    const [
      { data: products, error: e1 },
      { data: sales,    error: e2 },
      { data: clients,  error: e3 },
      { data: configs,  error: e4 },
    ] = await Promise.all([
      db.from('products').select('*').eq('merchant_id', merchant_id),
      db.from('sales').select('*').eq('merchant_id', merchant_id),
      db.from('clients').select('*').eq('merchant_id', merchant_id),
      db.from('configs').select('*').eq('merchant_id', merchant_id),
    ]);

    check(e1, 'products'); check(e2, 'sales'); check(e3, 'clients'); check(e4, 'configs');

    return res.status(200).json({
      success: true,
      data: {
        products: products || [],
        sales:    sales    || [],
        clients:  clients  || [],
        configs:  configs  || [],
      }
    });

  } catch(e) {
    console.error('Data error:', e);
    return res.status(500).json({ error: 'Erreur chargement: ' + e.message });
  }
};
