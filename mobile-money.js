// api/mobile-money.js — Webhook SMS Gateway Mobile Money (Supabase)
// ============================================================
const { getDb, cors, check } = require('./supabase-client');

const WEBHOOK_SECRET = process.env.MOBILE_MONEY_WEBHOOK_SECRET || 'ds_webhook_secret_2024';

const AMOUNT_TO_PLAN = [
  { min: 50000, plan: 'annuel',      days: 365 },
  { min: 15000, plan: 'trimestriel', days: 90  },
  { min: 6000,  plan: 'mensuel',     days: 30  },
  { min: 1000,  plan: 'essai',       days: 7   },
];

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const secret = req.headers['x-webhook-secret'];
  if (secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Accès non autorisé — secret invalide.' });
  }

  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Champ "message" requis.' });
  }

  console.log('[MobileMoney] SMS reçu:', message.substring(0, 120));

  const parsed = parseSMS(message);
  if (!parsed || (!parsed.phone && !parsed.amount)) {
    return res.status(422).json({ error: 'Format SMS non reconnu.', received: message });
  }

  const { phone, amount, transactionId, operator } = parsed;
  console.log(`[MobileMoney] phone:${phone} amount:${amount} txId:${transactionId} op:${operator}`);

  try {
    const db = getDb();

    // Vérifier doublon
    if (transactionId) {
      const { data: existing, error: e0 } = await db
        .from('payments')
        .select('id')
        .eq('transaction_id', transactionId)
        .limit(1);
      check(e0, 'Vérif doublon');

      if (existing && existing.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Paiement déjà enregistré.',
          transaction_id: transactionId,
          payment_id: existing[0].id
        });
      }
    }

    // Trouver le marchand
    const { merchant, merchantId } = await findMerchant(db, phone);

    // Déterminer le plan
    const planInfo = detectPlan(amount);

    // Enregistrer le paiement
    const paymentId = 'pay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const payment = {
      id:             paymentId,
      phone:          normalizePhone(phone),
      amount,
      transaction_id: transactionId || null,
      operator,
      merchant_id:    merchantId || null,
      plan:           planInfo.plan,
      days:           planInfo.days,
      statut:         merchantId ? 'activé' : 'orphelin',
      raw_message:    message.substring(0, 500),
      created_at:     new Date().toISOString()
    };

    const { error: e1 } = await db.from('payments').insert(payment);
    check(e1, 'Enregistrement paiement');

    // Activer abonnement si marchand trouvé
    if (merchantId && merchant) {
      const newExpiry = await activateSubscription(db, merchant, merchantId, planInfo);
      await logActivity(db, {
        type: 'payment_auto_sms', merchant_id: merchantId,
        nom_commerce: merchant.nom_commerce, amount, operator,
        transaction_id: transactionId, plan: planInfo.plan,
        days: planInfo.days, expiry: newExpiry
      });

      console.log(`[MobileMoney] ✅ ${merchant.nom_commerce} +${planInfo.days}j`);

      return res.status(200).json({
        success: true,
        action: 'subscription_activated',
        merchant: { id: merchantId, nom_commerce: merchant.nom_commerce, telephone: merchant.telephone },
        payment: { id: paymentId, amount, operator, transaction_id: transactionId, plan: planInfo.plan, days_added: planInfo.days, new_expiry: newExpiry }
      });

    } else {
      console.warn(`[MobileMoney] Paiement orphelin — ${phone}`);
      return res.status(200).json({
        success: true,
        action: 'payment_recorded_no_merchant',
        warning: `Aucun marchand trouvé pour le numéro ${phone}.`,
        payment: { id: paymentId, phone, amount, operator, transaction_id: transactionId }
      });
    }

  } catch(e) {
    console.error('[MobileMoney] Erreur:', e);
    return res.status(500).json({ error: 'Erreur serveur: ' + e.message });
  }
};

// ── Parseur SMS ───────────────────────────────────────────────
function parseSMS(message) {
  const msg = message.trim();
  let phone = null, amount = null, transactionId = null, operator = 'inconnu';

  const amountPatterns = [
    /([\d\s]{1,10})\s*F(?:\.?C\.?F\.?A\.?|CFA)?\b/i,
    /(?:montant|reçu)\s+de\s+([\d\s]{1,10})/i,
    /reçu\s+([\d\s]{1,10})\s*F/i,
    /\b(\d{3,7})\s*(?:francs?|FCFA|CFA)\b/i,
  ];
  for (const pat of amountPatterns) {
    const m = msg.match(pat);
    if (m) {
      const val = parseInt(m[1].replace(/\s/g, ''), 10);
      if (!isNaN(val) && val > 0 && val < 10000000) { amount = val; break; }
    }
  }

  const phonePatterns = [
    /de\s+\+?(225|226|221|223|224|228|229|235|237)\s?([\d\s]{8,10})/,
    /de\s+(0[5-9]\d{8})\b/,
    /de\s+(7\d{7})\b/,
    /\b(\+?(?:225|226|221|223|224|228|229|235)\d{8,10})\b/,
    /de\s+(\d{8})\b/,
  ];
  for (const pat of phonePatterns) {
    const m = msg.match(pat);
    if (m) { phone = (m[2] !== undefined ? m[1] + m[2] : m[1]).replace(/[\s\-]/g, ''); break; }
  }

  const txPatterns = [
    /(?:Transaction\s*ID|Trans(?:action)?|Réf(?:érence)?|Ref|ID\s*Trans?)\s*[:\s#]\s*([A-Z0-9]{5,20})/i,
    /\b(PP\d{4,12})\b/i,
    /\b(TRF[A-Z0-9]{4,15})\b/i,
    /\b(OFT\d{4,12})\b/i,
    /\b(OM[A-Z0-9]{6,14})\b/i,
    /\b([A-Z]{2,5}\d{5,12})\b/,
  ];
  for (const pat of txPatterns) {
    const m = msg.match(pat);
    if (m) { transactionId = m[1].toUpperCase(); break; }
  }

  const lower = msg.toLowerCase();
  if (lower.includes('orange'))                              operator = 'orange';
  else if (lower.includes('moov') || lower.includes('flooz')) operator = 'moov';
  else if (lower.includes('wave'))                           operator = 'wave';
  else if (lower.includes('mtn'))                            operator = 'mtn';

  return { phone, amount, transactionId, operator };
}

function normalizePhone(p) { return p ? p.replace(/[\s+\-().]/g, '') : ''; }

async function findMerchant(db, phone) {
  const variants = getPhoneVariants(phone);
  for (const v of variants) {
    const { data, error } = await db.from('merchants').select('*').eq('telephone', v).limit(1);
    if (!error && data && data.length > 0) {
      return { merchant: data[0], merchantId: data[0].id };
    }
  }
  return { merchant: null, merchantId: null };
}

function getPhoneVariants(phone) {
  if (!phone) return [];
  const c = phone.replace(/[\s+\-().]/g, '');
  const s = new Set([c]);
  for (const code of ['225','226','221','223','224','228','229','235']) {
    if (c.startsWith(code)) { const l = c.slice(code.length); s.add(l); s.add('0'+l); s.add('+'+c); }
  }
  if (c.startsWith('0') && c.length === 10) s.add(c.slice(1));
  return [...s];
}

function detectPlan(amount) {
  for (const tier of AMOUNT_TO_PLAN) {
    if (amount >= tier.min) return { plan: tier.plan, days: tier.days };
  }
  return { plan: 'essai', days: 7 };
}

async function activateSubscription(db, merchant, merchantId, planInfo) {
  const base = merchant.licence_expiry && new Date(merchant.licence_expiry) > new Date()
    ? new Date(merchant.licence_expiry) : new Date();
  base.setDate(base.getDate() + planInfo.days);
  const newExpiry = base.toISOString();

  const { error } = await db.from('merchants').update({
    licence: 'active', actif: true,
    licence_expiry: newExpiry, plan_type: planInfo.plan,
    updated_at: new Date().toISOString()
  }).eq('id', merchantId);
  check(error, 'Activation abonnement');

  return newExpiry;
}

async function logActivity(db, data) {
  const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  const { error } = await db.from('activity_log').insert({ id: logId, ...data, created_at: new Date().toISOString() });
  if (error) console.warn('[logActivity]', error.message);
}
