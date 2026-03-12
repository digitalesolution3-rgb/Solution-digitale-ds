# Digitale Solution v2 — Guide d'Installation
## Mobile Money Gateway + Mode Offline + PWA

---

## 📋 RÉSUMÉ DES MODIFICATIONS

| Fonctionnalité | Fichier(s) modifié(s) | Statut |
|---|---|---|
| Webhook Mobile Money | `api/mobile-money.js` (NOUVEAU) | ✅ |
| Firebase Admin Helper | `api/_firebase.js` (NOUVEAU) | ✅ |
| Mode pré-offline | `public/sw.js` (amélioré) | ✅ |
| PWA installable | `public/index.html` + `manifest.json` | ✅ |
| Indicateur hors-ligne | `public/index.html` | ✅ |
| File d'attente offline | `public/index.html` + `public/sw.js` | ✅ |
| Sync automatique | `public/sw.js` | ✅ |
| Routes Vercel | `vercel.json` | ✅ |

---

## 🚀 INSTALLATION EN 5 ÉTAPES

### Étape 1 — Structure des fichiers

```
digitale-solution/
├── api/
│   ├── _firebase.js       ← Helper Firebase Admin (NOUVEAU)
│   ├── admin.js           ← Admin actions (inchangé)
│   ├── data.js            ← Chargement données (inchangé)
│   ├── login.js           ← Connexion (inchangé)
│   ├── mobile-money.js    ← Webhook SMS (NOUVEAU)
│   ├── register.js        ← Inscription (inchangé)
│   └── sync.js            ← Sync données (inchangé)
├── public/
│   ├── index.html         ← App principale (modifié : PWA + offline)
│   ├── manifest.json      ← Manifest PWA (amélioré)
│   ├── sw.js              ← Service Worker v2 (amélioré)
│   ├── icon-192.png       ← Icône PWA (À FOURNIR)
│   └── icon-512.png       ← Icône PWA (À FOURNIR)
├── .env.example           ← Template variables d'env
├── package.json
└── vercel.json
```

### Étape 2 — Configurer Firebase

1. Allez sur [console.firebase.google.com](https://console.firebase.google.com)
2. Créez/sélectionnez votre projet
3. **Paramètres → Comptes de service → Générer une nouvelle clé privée**
4. Téléchargez le fichier JSON du Service Account

Sur **Vercel** :
- Dashboard → Settings → Environment Variables
- Ajoutez `FIREBASE_SERVICE_ACCOUNT` avec le contenu JSON complet (sur une ligne)

### Étape 3 — Configurer le Webhook Mobile Money

#### 3a. Variable d'environnement
Sur Vercel, ajoutez :
```
MOBILE_MONEY_WEBHOOK_SECRET = votre_secret_aleatoire_ici
```

#### 3b. Configurer SMS Forwarder (Android)
Installez **SMS Forwarder** ou **HTTP SMS** sur le téléphone qui reçoit les SMS Mobile Money :

1. Ouvrez l'app SMS Forwarder
2. Ajoutez une règle de transfert :
   - **URL** : `https://votre-app.vercel.app/api/mobile-money`
   - **Méthode** : `POST`
   - **Corps** : `{"message": "%sms_body%"}` (selon l'app)
   - **Headers** : `X-Webhook-Secret: votre_secret_ici`
3. Filtre SMS (optionnel) : `Orange Money` ou `Moov Money`

#### 3c. Exemple de configuration dans SMS Forwarder
```json
{
  "url": "https://votre-app.vercel.app/api/mobile-money",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json",
    "X-Webhook-Secret": "votre_secret_ici"
  },
  "body": "{\"message\": \"[MESSAGE]\"}"
}
```

### Étape 4 — Ajouter les icônes PWA

Créez deux fichiers PNG dans `public/` :
- `icon-192.png` — 192×192 pixels
- `icon-512.png` — 512×512 pixels

Utilisez votre logo ou un générateur comme [realfavicongenerator.net](https://realfavicongenerator.net)

### Étape 5 — Déployer sur Vercel

```bash
# Depuis la racine du projet
vercel --prod
```

---

## 🧪 TESTER LE WEBHOOK MOBILE MONEY

### Test avec curl
```bash
# Remplacez l'URL et le secret par vos valeurs
curl -X POST https://votre-app.vercel.app/api/mobile-money \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: votre_secret_ici" \
  -d '{"message": "Vous avez reçu 5000F de 0712345678. Transaction ID: PP92822"}'
```

### Réponse attendue (succès)
```json
{
  "success": true,
  "action": "subscription_activated",
  "merchant": {
    "id": "merchant_xxx",
    "nom_commerce": "Restaurant Djolof",
    "telephone": "0712345678"
  },
  "payment": {
    "id": "pay_xxx",
    "amount": 5000,
    "operator": "orange",
    "transaction_id": "PP92822",
    "plan": "mensuel",
    "days_added": 30,
    "new_expiry": "2024-04-01T..."
  }
}
```

### Formats SMS supportés

| Opérateur | Pays | Format SMS exemple |
|---|---|---|
| Orange Money | 🇨🇮 Côte d'Ivoire | `Vous avez reçu 5000F de 0712345678. ID: PP92822` |
| Orange Money | 🇧🇫 Burkina Faso | `Vous avez reçu 5000F de +22670123456. Transaction: OFT123456` |
| Orange Money | 🇸🇳 Sénégal | `Vous avez reçu 5000 FCFA de +221771234567` |
| Moov Money | 🇧🇫 Burkina Faso | `Transaction effectuée. Reçu 5000FCFA de 70123456` |
| Moov Money | 🇨🇮 Côte d'Ivoire | `Vous avez reçu 5000 CFA de +22501234567` |

---

## 📊 TABLES FIRESTORE CRÉÉES

### `payments` (NOUVELLE)
| Champ | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `phone` | string | Numéro de l'expéditeur |
| `amount` | number | Montant reçu (FCFA) |
| `transaction_id` | string | ID transaction opérateur |
| `operator` | string | `orange` / `moov` / `wave` |
| `merchant_id` | string | Lié au marchand |
| `plan` | string | `mensuel` / `annuel` |
| `days` | number | Jours d'abonnement activés |
| `statut` | string | `activé` / `orphelin` |
| `created_at` | timestamp | Date du paiement |

### `merchants` (MODIFIÉE — champs supplémentaires)
| Champ | Description |
|---|---|
| `licence_expiry` | Extended automatiquement (+30 ou +365 jours) |
| `plan_type` | `mensuel` / `annuel` selon montant reçu |
| `actif` | `true` — réactivé automatiquement |

### `activity_log` (NOUVELLE)
Journalise chaque activation automatique avec opérateur, montant, transaction ID.

---

## 📱 MODE HORS LIGNE — Comportement

| Situation | Comportement |
|---|---|
| Internet coupé | Bannière orange s'affiche |
| Vente effectuée hors ligne | Enregistrée localement + mise en file |
| Connexion restaurée | Sync automatique (Background Sync) |
| Sync manuelle | Bouton "Synchroniser" dans la bannière |

---

## 🔧 CONFIGURATION DU MONTANT → PLAN

Dans `api/mobile-money.js`, modifiez `AMOUNT_TO_PLAN` :
```javascript
const AMOUNT_TO_PLAN = [
  { min: 40000, plan: 'annuel',  days: 365 }, // ≥ 40 000 FCFA → 1 an
  { min: 5000,  plan: 'mensuel', days: 30  }, // ≥ 5 000 FCFA  → 30 jours
  { min: 1000,  plan: 'essai',   days: 7   }, // ≥ 1 000 FCFA  → 7 jours
];
```

---

## ❓ FAQ

**Q : Que se passe-t-il si le marchand n'est pas trouvé ?**
Le paiement est enregistré avec `statut: 'orphelin'`. Vous pouvez le retrouver dans Firestore > `payments` et l'activer manuellement depuis le panneau admin.

**Q : Le doublon est-il protégé ?**
Oui. Si `transaction_id` est déjà dans la table `payments`, l'API retourne un 409 sans ré-activer.

**Q : Le Service Worker fonctionne sur tous les navigateurs ?**
Cache offline : Chrome, Firefox, Safari, Edge. Background Sync : Chrome/Edge uniquement. Sur iOS/Safari, le fallback app-side prend le relais automatiquement.

**Q : L'app peut-elle être installée sur iOS ?**
Oui. Sur Safari : partager → "Sur l'écran d'accueil". Les méta tags Apple sont en place.
