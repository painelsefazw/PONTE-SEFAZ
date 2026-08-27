-- ============================================================
-- NF-e Engine — Schema Completo do Banco de Dados
-- Supabase PostgreSQL
-- Gerado em: 2026-07-24
-- ============================================================
-- Execute este arquivo no SQL Editor do Supabase para recriar
-- todas as tabelas, indexes e constraints do zero.
-- ============================================================

-- 1. CONFIGURAÇÃO GLOBAL (chave-valor)
CREATE TABLE IF NOT EXISTS webapp_config (
  chave VARCHAR(100) PRIMARY KEY,
  valor TEXT NOT NULL
);

-- 2. EMPRESAS (multi-tenant, certificados criptografados)
CREATE TABLE IF NOT EXISTS webapp_empresas (
  cnpj VARCHAR(14) PRIMARY KEY,
  razao_social TEXT NOT NULL,
  fantasia TEXT,
  ie TEXT NOT NULL,
  crt VARCHAR(1) NOT NULL,
  uf VARCHAR(2) NOT NULL,
  ambiente VARCHAR(1) NOT NULL DEFAULT '2',
  logradouro TEXT NOT NULL,
  numero TEXT NOT NULL,
  complemento TEXT,
  bairro TEXT NOT NULL,
  cod_municipio TEXT NOT NULL,
  nome_municipio TEXT NOT NULL,
  cep TEXT NOT NULL,
  fone TEXT,
  pfx_encrypted TEXT NOT NULL,
  pfx_password_encrypted TEXT NOT NULL,
  senha_acesso_hash TEXT,
  ativa BOOLEAN NOT NULL DEFAULT true,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  csc_id TEXT,
  csc_token TEXT
);

-- 2.1. API KEYS (credenciais de integração isoladas por empresa)
CREATE TABLE IF NOT EXISTS webapp_api_keys (
  id SERIAL PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix VARCHAR(32) NOT NULL,
  empresa_cnpj VARCHAR(14) NOT NULL,
  nome TEXT NOT NULL DEFAULT 'Integracao',
  escopo VARCHAR(10) NOT NULL DEFAULT 'full',
  ativa BOOLEAN NOT NULL DEFAULT true,
  ultimo_uso TIMESTAMPTZ,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  revogada_em TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON webapp_api_keys (key_hash) WHERE ativa = TRUE;
CREATE INDEX IF NOT EXISTS idx_api_keys_empresa ON webapp_api_keys (empresa_cnpj);

-- 3. NOTAS FISCAIS EMITIDAS
CREATE TABLE IF NOT EXISTS webapp_notas (
  chave_acesso VARCHAR(44) PRIMARY KEY,
  numero TEXT NOT NULL,
  serie TEXT NOT NULL,
  ambiente VARCHAR(1) NOT NULL,
  dest_nome TEXT NOT NULL DEFAULT '',
  dest_doc TEXT NOT NULL DEFAULT '',
  v_nf TEXT NOT NULL DEFAULT '0.00',
  protocolo TEXT,
  dh_recbto TEXT,
  cstat TEXT,
  status TEXT NOT NULL DEFAULT 'AUTORIZADA',
  nfe_json JSONB,
  xml TEXT,
  emitida_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  empresa_cnpj VARCHAR(14) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_webapp_notas_emitida ON webapp_notas (emitida_em DESC);
CREATE INDEX IF NOT EXISTS idx_webapp_notas_empresa ON webapp_notas (empresa_cnpj);

-- 4. PRODUTOS (catálogo por empresa)
CREATE TABLE IF NOT EXISTS webapp_produtos (
  id SERIAL PRIMARY KEY,
  empresa_cnpj VARCHAR(14) NOT NULL,
  codigo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  ean TEXT,
  ncm TEXT NOT NULL,
  cest TEXT,
  cfop TEXT NOT NULL DEFAULT '5102',
  unidade TEXT NOT NULL DEFAULT 'UN',
  valor_unitario NUMERIC,
  origem TEXT NOT NULL DEFAULT '0',
  cst_csosn TEXT NOT NULL,
  aliq_icms TEXT,
  red_bc_icms TEXT,
  cst_ipi TEXT NOT NULL DEFAULT '53',
  aliq_ipi TEXT,
  cst_pis TEXT NOT NULL DEFAULT '99',
  cst_cofins TEXT NOT NULL DEFAULT '99',
  mva TEXT,
  aliq_icms_st TEXT,
  cbenef TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_cnpj, codigo)
);

-- 5. REGRAS FISCAIS (NCM + UF)
CREATE TABLE IF NOT EXISTS webapp_regras_fiscais (
  id SERIAL PRIMARY KEY,
  ncm VARCHAR(8) NOT NULL,
  uf VARCHAR(2) NOT NULL DEFAULT 'SP',
  descricao TEXT NOT NULL DEFAULT '',
  cst_icms_normal TEXT,
  csosn_simples TEXT,
  cfop_saida TEXT DEFAULT '5102',
  aliq_icms TEXT,
  red_bc_icms TEXT,
  cst_ipi TEXT DEFAULT '53',
  aliq_ipi TEXT,
  cest TEXT,
  mva TEXT,
  aliq_icms_st TEXT,
  cbenef TEXT,
  base_legal TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ncm, uf)
);

-- 6. SEQUÊNCIA DE NUMERAÇÃO (legado, tabela global)
CREATE TABLE IF NOT EXISTS webapp_sequencia (
  serie TEXT PRIMARY KEY,
  ultimo INTEGER NOT NULL DEFAULT 0
);

-- 7. SEQUÊNCIA DE NUMERAÇÃO (por empresa)
CREATE TABLE IF NOT EXISTS webapp_sequencia2 (
  cnpj VARCHAR(14) NOT NULL,
  serie TEXT NOT NULL,
  ultimo INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cnpj, serie)
);

-- 8. BILLING (controle de planos e uso)
CREATE TABLE IF NOT EXISTS webapp_billing (
  cnpj VARCHAR(14) PRIMARY KEY,
  plano VARCHAR(20) NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  notas_mes INTEGER NOT NULL DEFAULT 0,
  mes_referencia VARCHAR(7) NOT NULL DEFAULT to_char(now(), 'YYYY-MM'),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. TABELAS DO ENGINE (idempotência e inbox)
CREATE TABLE IF NOT EXISTS nfe_inbox (
  id SERIAL PRIMARY KEY,
  empresa_id VARCHAR(50) NOT NULL,
  estabelecimento_id VARCHAR(50) NOT NULL,
  ambiente VARCHAR(5) NOT NULL,
  servico VARCHAR(50) NOT NULL,
  documento_id VARCHAR(255) NOT NULL,
  payload TEXT NOT NULL,
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unq_nfe_inbox UNIQUE (empresa_id, estabelecimento_id, ambiente, servico, documento_id)
);

CREATE TABLE IF NOT EXISTS nfe_outbox_idempotency (
  id SERIAL PRIMARY KEY,
  idempotency_key VARCHAR(255) GENERATED ALWAYS AS (
    empresa_id || '-' || estabelecimento_id || '-' || ambiente || '-' || servico || '-' || documento_id
  ) STORED,
  empresa_id VARCHAR(50) NOT NULL,
  estabelecimento_id VARCHAR(50) NOT NULL,
  ambiente VARCHAR(5) NOT NULL,
  servico VARCHAR(50) NOT NULL,
  documento_id VARCHAR(255) NOT NULL,
  status_tecnico VARCHAR(50) NOT NULL,
  status_fiscal VARCHAR(50),
  tentativa INT DEFAULT 0,
  proxima_tentativa TIMESTAMP,
  locked_by VARCHAR(255),
  locked_at TIMESTAMP,
  lock_expires_at TIMESTAMP,
  timeout_at TIMESTAMP,
  requires_reconciliation BOOLEAN DEFAULT FALSE,
  receipt_number VARCHAR(100),
  access_key VARCHAR(44),
  last_error_code VARCHAR(50),
  last_error_message TEXT,
  dead_letter_at TIMESTAMP,
  payload TEXT,
  xml_request TEXT,
  soap_response TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  versao INT DEFAULT 1,
  CONSTRAINT unq_nfe_idempotency UNIQUE (empresa_id, estabelecimento_id, ambiente, servico, documento_id),
  CONSTRAINT chk_status_tecnico CHECK (status_tecnico IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED_DEAD_LETTER', 'UNKNOWN'))
);

CREATE INDEX IF NOT EXISTS idx_nfe_outbox_pending ON nfe_outbox_idempotency(proxima_tentativa)
WHERE status_tecnico IN ('PENDING', 'UNKNOWN');

CREATE TABLE IF NOT EXISTS nfe (
  id SERIAL PRIMARY KEY,
  chave_acesso VARCHAR(44) UNIQUE NOT NULL,
  numero VARCHAR(9) NOT NULL,
  serie VARCHAR(3) NOT NULL,
  cnpj_emitente VARCHAR(14) NOT NULL,
  ambiente VARCHAR(1) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
  cstat VARCHAR(3),
  xmotivo TEXT,
  nprot VARCHAR(15),
  xml_enviado TEXT NOT NULL,
  xml_retorno TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nfe_cnpj ON nfe(cnpj_emitente);
CREATE INDEX IF NOT EXISTS idx_nfe_status ON nfe(status);

-- ============================================================
-- FIM DO SCHEMA
-- ============================================================
