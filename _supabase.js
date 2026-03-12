// api/_supabase.js — Helper Supabase (remplace Firebase)
// Utilisé par tous les endpoints : login, register, sync, admin, mobile-money
// ============================================================

const { createClient } = require('@supabase/supabase-js');

let _supabase = null;

/**
 * Retourne le client Supabase Admin (service role).
 * Initialise au premier appel en lisant les variables d'environnement.
 */
function getDb() {
  if (_supabase) return _supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Variables manquantes : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.'
    );
  }

  _supabase = createClient(url, key, {
    auth: { persistSession: false }
  });

  console.log('✅ Supabase Admin initialisé.');
  return _supabase;
}

/**
 * Hash simple compatible avec DB._hash() du frontend (index.html).
 * Utilisé pour vérifier les mots de passe et PINs.
 */
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  return 'h' + Math.abs(h).toString(36);
}

/**
 * Headers CORS — autorise les requêtes cross-origin.
 */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Webhook-Secret');
}

/**
 * Vérifie une erreur Supabase et la lance si elle existe.
 */
function check(error, context) {
  if (error) {
    console.error(`[Supabase] Erreur ${context}:`, error.message);
    throw new Error(`${context}: ${error.message}`);
  }
}

module.exports = { getDb, hash, cors, check };
