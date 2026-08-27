/**
 * DDL e tipos para a tabela de NF-e no PostgreSQL.
 */

export const CREATE_TABLE_SQL = `
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nfe_cnpj ON nfe(cnpj_emitente);
CREATE INDEX IF NOT EXISTS idx_nfe_status ON nfe(status);
`;

export enum NFeStatus {
  PENDENTE = 'PENDENTE',
  ENVIADA = 'ENVIADA',
  AUTORIZADA = 'AUTORIZADA',
  REJEITADA = 'REJEITADA',
  DENEGADA = 'DENEGADA',
  CANCELADA = 'CANCELADA',
  ERRO = 'ERRO',
}
