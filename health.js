// api/health.js — Diagnostic endpoint (aucune dépendance externe)
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Test 1 : routing OK
  const checks = { routing: true };

  // Test 2 : variables d'environnement présentes
  checks.supabase_url     = !!process.env.SUPABASE_URL;
  checks.supabase_key     = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  checks.node_version     = process.version;
  checks.env              = process.env.VERCEL_ENV || 'local';

  // Test 3 : charger @supabase/supabase-js
  try {
    require('@supabase/supabase-js');
    checks.supabase_module = 'OK';
  } catch(e) {
    checks.supabase_module = 'ERREUR: ' + e.message;
  }

  // Test 4 : charger le helper _supabase
  try {
    require('./supabase-client');
    checks.helper = 'OK';
  } catch(e) {
    checks.helper = 'ERREUR: ' + e.message;
  }

  // Test 5 : connexion Supabase réelle
  if (checks.supabase_url && checks.supabase_key && checks.supabase_module === 'OK') {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const { data, error } = await db.from('merchants').select('id').limit(1);
      checks.db_connection = error ? 'ERREUR: ' + error.message : 'OK (' + (data?.length || 0) + ' lignes)';
    } catch(e) {
      checks.db_connection = 'ERREUR: ' + e.message;
    }
  } else {
    checks.db_connection = 'IGNORÉ (prérequis manquants)';
  }

  const allOk = Object.values(checks).every(v => v === true || v === 'OK' || typeof v === 'string' && v.startsWith('OK'));

  res.status(allOk ? 200 : 500).json({
    status: allOk ? '✅ Tout est OK' : '❌ Problème détecté',
    checks
  });
};
