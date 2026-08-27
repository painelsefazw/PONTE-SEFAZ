-- Tabela de Recebimentos (Inbox) para deduplicação de respostas
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

-- Tabela de Envio e Idempotência Transacional (Outbox)
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
    
    status_tecnico VARCHAR(50) NOT NULL, -- PENDING, PROCESSING, SUCCESS, FAILED_DEAD_LETTER, UNKNOWN
    status_fiscal VARCHAR(50),           -- AUTORIZADO, REJEITADO, DENEGADO
    
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

-- Indices parciais para otimização de leitura na Outbox (Apenas não processados)
CREATE INDEX idx_nfe_outbox_pending ON nfe_outbox_idempotency(proxima_tentativa) 
WHERE status_tecnico IN ('PENDING', 'UNKNOWN');
