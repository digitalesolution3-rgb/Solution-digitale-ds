-- ============================================================
--  Digitale Solution — Schéma SQL Supabase
--  Coller et exécuter dans : Supabase Dashboard → SQL Editor
-- ============================================================

-- ── merchants ─────────────────────────────────────────────────
create table if not exists merchants (
  id              text primary key,
  nom_commerce    text not null,
  proprietaire    text not null,
  telephone       text not null unique,
  ville           text,
  type            text default 'boutique',
  password        text not null,
  licence         text default 'active',
  licence_expiry  timestamptz,
  actif           boolean default true,
  plan_type       text default 'mensuel',
  created_at      timestamptz default now(),
  updated_at      timestamptz
);

-- ── configs ───────────────────────────────────────────────────
create table if not exists configs (
  id               text primary key,
  merchant_id      text not null references merchants(id) on delete cascade,
  couleur_theme    text default '#E8730C',
  devise           text default 'FCFA',
  message_accueil  text,
  wa_message       text,
  pin              text default '',
  created_at       timestamptz default now()
);

-- ── products ──────────────────────────────────────────────────
create table if not exists products (
  id           text primary key,
  merchant_id  text not null references merchants(id) on delete cascade,
  nom          text not null,
  prix         numeric(12,2) not null default 0,
  stock        integer default 0,
  categorie    text,
  image        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz
);

-- ── clients ───────────────────────────────────────────────────
create table if not exists clients (
  id           text primary key,
  merchant_id  text not null references merchants(id) on delete cascade,
  nom          text not null,
  telephone    text,
  whatsapp     text,
  total_achats numeric(12,2) default 0,
  nb_achats    integer default 0,
  created_at   timestamptz default now()
);

-- ── sales ─────────────────────────────────────────────────────
create table if not exists sales (
  id            text primary key,
  merchant_id   text not null references merchants(id) on delete cascade,
  client_id     text,
  client_nom    text,
  client_wa     text,
  items         jsonb,
  total         numeric(12,2) not null default 0,
  paiement      text default 'especes',
  created_at    timestamptz default now()
);

-- ── payments (Mobile Money) ────────────────────────────────────
create table if not exists payments (
  id              text primary key,
  phone           text,
  amount          numeric(12,2) not null,
  transaction_id  text unique,
  operator        text,
  merchant_id     text references merchants(id) on delete set null,
  plan            text,
  days            integer,
  statut          text default 'orphelin',
  raw_message     text,
  created_at      timestamptz default now()
);

-- ── activity_log ──────────────────────────────────────────────
create table if not exists activity_log (
  id            text primary key,
  type          text,
  merchant_id   text,
  nom_commerce  text,
  amount        numeric(12,2),
  operator      text,
  transaction_id text,
  plan          text,
  days          integer,
  expiry        timestamptz,
  created_at    timestamptz default now()
);

-- ── Index pour performances ───────────────────────────────────
create index if not exists idx_merchants_telephone  on merchants(telephone);
create index if not exists idx_products_merchant    on products(merchant_id);
create index if not exists idx_sales_merchant       on sales(merchant_id);
create index if not exists idx_clients_merchant     on clients(merchant_id);
create index if not exists idx_configs_merchant     on configs(merchant_id);
create index if not exists idx_payments_transaction on payments(transaction_id);
create index if not exists idx_payments_merchant    on payments(merchant_id);

-- ── RLS (Row Level Security) ──────────────────────────────────
-- Le backend utilise la clé service_role qui bypass RLS.
-- Activer RLS bloque l'accès public direct (sécurité renforcée).
alter table merchants    enable row level security;
alter table configs      enable row level security;
alter table products     enable row level security;
alter table clients      enable row level security;
alter table sales        enable row level security;
alter table payments     enable row level security;
alter table activity_log enable row level security;

-- Aucune politique publique → seul le service_role (backend) peut lire/écrire.
-- Pour ajouter un accès front direct futur, créer des policies JWT ici.
