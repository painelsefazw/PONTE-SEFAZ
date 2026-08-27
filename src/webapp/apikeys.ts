/**
 * API Keys por empresa — isolamento multi-tenant para integrações externas.
 *
 * A chave carrega o CNPJ da empresa no banco: quem tem a chave opera SÓ aquela
 * empresa, independente do header x-empresa-cnpj que enviar. Isso impede que um
 * cliente com chave válida leia dados de outro tenant trocando o header.
 *
 * Guardamos apenas o SHA-256 da chave (alta entropia dispensa scrypt, que seria
 * lento demais para rodar a cada request). A chave em claro aparece uma única vez,
 * no momento da criação.
 */
import { Pool } from 'pg';
import * as crypto from 'crypto';

/**
 * Ambientes que a chave pode usar. O ERP pede o ambiente a cada requisição;
 * a chave define se aquele pedido é autorizado.
 * - `homologacao`: só emite teste, mesmo que a empresa esteja em produção
 * - `producao`: só emite valendo
 * - `ambos`: o ERP escolhe livremente
 */
export type AmbientePermitido = 'homologacao' | 'producao' | 'ambos';

export interface ApiKeyPublic {
  id: number;
  prefixo: string;
  nome: string;
  empresaCnpj: string;
  escopo: 'full' | 'readonly';
  ambientePermitido: AmbientePermitido;
  ativa: boolean;
  ultimoUso?: string;
  criadaEm: string;
  revogadaEm?: string;
}

export interface ApiKeyContext {
  id: number;
  empresaCnpj: string;
  escopo: 'full' | 'readonly';
  ambientePermitido: AmbientePermitido;
  nome: string;
}

/** Normaliza valor vindo do corpo/banco — default `producao` é o mais restritivo
 *  para quem já tem chave criada antes desta coluna existir. */
export function normalizarAmbientePermitido(valor: unknown): AmbientePermitido {
  return valor === 'homologacao' || valor === 'ambos' ? valor : 'producao';
}

const PREFIX_LEN = 16;

/** `nfe_live_xxx` (produção) ou `nfe_test_xxx` (homologação). */
function gerarChave(ambiente: '1' | '2'): string {
  const marca = ambiente === '1' ? 'live' : 'test';
  const random = crypto.randomBytes(32).toString('base64url');
  return `nfe_${marca}_${random}`;
}

function hashChave(chave: string): string {
  return crypto.createHash('sha256').update(chave).digest('hex');
}

/** Uma chave só é candidata a lookup se tiver o formato esperado. */
export function pareceApiKey(valor: string): boolean {
  return /^nfe_(live|test)_[A-Za-z0-9_-]{20,}$/.test(valor);
}

export class ApiKeyStore {
  private pool: Pool;
  private initialized = false;

  constructor(poolOrUrl: Pool | string) {
    if (typeof poolOrUrl === 'string') {
      const isLocal = /localhost|127\.0\.0\.1/.test(poolOrUrl);
      this.pool = new Pool({
        connectionString: poolOrUrl,
        ssl: isLocal ? undefined : { rejectUnauthorized: false },
        max: 3,
      });
    } else {
      this.pool = poolOrUrl;
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_api_keys (
        id SERIAL PRIMARY KEY,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix VARCHAR(32) NOT NULL,
        empresa_cnpj VARCHAR(14) NOT NULL,
        nome TEXT NOT NULL DEFAULT 'Integracao',
        escopo VARCHAR(10) NOT NULL DEFAULT 'full',
        ativa BOOLEAN NOT NULL DEFAULT TRUE,
        ultimo_uso TIMESTAMPTZ,
        criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revogada_em TIMESTAMPTZ
      );
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON webapp_api_keys (key_hash) WHERE ativa = TRUE`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_api_keys_empresa ON webapp_api_keys (empresa_cnpj)`,
    );
    // Ambiente autorizado por chave. Default 'producao' porque chaves criadas
    // antes desta coluna já operavam conforme o cadastro da empresa — e todas as
    // empresas estão em produção; abrir para 'ambos' afrouxaria retroativamente.
    await this.pool.query(
      `ALTER TABLE webapp_api_keys
         ADD COLUMN IF NOT EXISTS ambiente_permitido VARCHAR(12) NOT NULL DEFAULT 'producao'`,
    );
    this.initialized = true;
  }

  /** Cria a chave e devolve o valor em claro — única oportunidade de copiá-lo. */
  async criar(opts: {
    empresaCnpj: string;
    nome: string;
    ambiente: '1' | '2';
    escopo?: 'full' | 'readonly';
    ambientePermitido?: AmbientePermitido;
  }): Promise<{ chave: string; registro: ApiKeyPublic }> {
    const cnpj = opts.empresaCnpj.replace(/\D/g, '');
    const ambientePermitido = normalizarAmbientePermitido(opts.ambientePermitido);
    // O prefixo é rótulo: `live` só quando a chave NÃO pode tocar homologação,
    // senão o nome mentiria sobre o que ela faz.
    const chave = gerarChave(ambientePermitido === 'producao' ? '1' : '2');
    const prefixo = chave.slice(0, PREFIX_LEN);
    const escopo = opts.escopo === 'readonly' ? 'readonly' : 'full';

    const r = await this.pool.query(
      `INSERT INTO webapp_api_keys (key_hash, key_prefix, empresa_cnpj, nome, escopo, ambiente_permitido)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, key_prefix, empresa_cnpj, nome, escopo, ambiente_permitido, ativa, criada_em`,
      [hashChave(chave), prefixo, cnpj, opts.nome || 'Integracao', escopo, ambientePermitido],
    );
    const row = r.rows[0];
    return {
      chave,
      registro: {
        id: row.id,
        prefixo: row.key_prefix,
        nome: row.nome,
        empresaCnpj: row.empresa_cnpj,
        escopo: row.escopo,
        ambientePermitido: row.ambiente_permitido,
        ativa: row.ativa,
        criadaEm: row.criada_em,
      },
    };
  }

  /**
   * O tenant da chave pode ser uma empresa emitente do Emissor OU um cliente de
   * API — são cadastros separados. Enquanto isto era um INNER JOIN só com
   * webapp_empresas, toda chave emitida para cliente de API nascia morta: era
   * gravada, aparecia ativa no painel e devolvia 401 em 100% das chamadas.
   */
  private async tenantAtivo(cnpj: string): Promise<boolean> {
    const emp = await this.pool
      .query(`SELECT 1 FROM webapp_empresas WHERE cnpj = $1 AND ativa = TRUE`, [cnpj])
      .catch(() => null);
    if (emp?.rows.length) return true;
    // Cliente suspenso ou cancelado perde a credencial junto com o status.
    const cli = await this.pool
      .query(
        `SELECT 1 FROM webapp_api_clients WHERE empresa_cnpj = $1 AND status IN ('active', 'sandbox')`,
        [cnpj],
      )
      .catch(() => null);
    return !!cli?.rows.length;
  }

  /** Valida a chave e devolve o tenant vinculado (null se inválida/revogada). */
  async validar(chave: string): Promise<ApiKeyContext | null> {
    if (!pareceApiKey(chave)) return null;
    const r = await this.pool.query(
      `SELECT k.id, k.empresa_cnpj, k.escopo, k.ambiente_permitido, k.nome
         FROM webapp_api_keys k
        WHERE k.key_hash = $1 AND k.ativa = TRUE`,
      [hashChave(chave)],
    );
    const row = r.rows[0];
    if (!row) return null;
    if (!(await this.tenantAtivo(row.empresa_cnpj))) return null;
    // Best-effort: telemetria de uso nunca deve derrubar a request autenticada.
    this.pool
      .query(`UPDATE webapp_api_keys SET ultimo_uso = NOW() WHERE id = $1`, [row.id])
      .catch(() => {});
    return {
      id: row.id,
      empresaCnpj: row.empresa_cnpj,
      escopo: row.escopo,
      ambientePermitido: normalizarAmbientePermitido(row.ambiente_permitido),
      nome: row.nome,
    };
  }

  async listar(empresaCnpj?: string): Promise<ApiKeyPublic[]> {
    const cnpj = empresaCnpj ? empresaCnpj.replace(/\D/g, '') : null;
    const r = await this.pool.query(
      `SELECT id, key_prefix, empresa_cnpj, nome, escopo, ambiente_permitido, ativa, ultimo_uso, criada_em, revogada_em
         FROM webapp_api_keys
        WHERE ($1::text IS NULL OR empresa_cnpj = $1)
        ORDER BY criada_em DESC`,
      [cnpj],
    );
    return r.rows.map((row: any) => ({
      id: row.id,
      prefixo: row.key_prefix,
      nome: row.nome,
      empresaCnpj: row.empresa_cnpj,
      escopo: row.escopo,
      ambientePermitido: normalizarAmbientePermitido(row.ambiente_permitido),
      ativa: row.ativa,
      ultimoUso: row.ultimo_uso ?? undefined,
      criadaEm: row.criada_em,
      revogadaEm: row.revogada_em ?? undefined,
    }));
  }

  async revogar(id: number, empresaCnpj?: string): Promise<boolean> {
    const cnpj = empresaCnpj ? empresaCnpj.replace(/\D/g, '') : null;
    const r = await this.pool.query(
      `UPDATE webapp_api_keys SET ativa = FALSE, revogada_em = NOW()
        WHERE id = $1 AND ativa = TRUE AND ($2::text IS NULL OR empresa_cnpj = $2)`,
      [id, cnpj],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Apaga o registro da chave — some da lista, sem rastro.
   *
   * Diferente de `revogar()`, que preserva o histórico: quem usou, quando, e que
   * foi desativada. Serve para limpar a tela de chaves de teste que não
   * interessam mais.
   *
   * Devolve a linha apagada para o chamador saber o que foi removido — em
   * especial se a chave ainda estava ativa, caso em que a integração que a usava
   * para de funcionar no mesmo instante.
   */
  async excluir(
    id: number,
    empresaCnpj?: string,
  ): Promise<{ nome: string; prefixo: string; estavaAtiva: boolean } | null> {
    const cnpj = empresaCnpj ? empresaCnpj.replace(/\D/g, '') : null;
    const r = await this.pool.query(
      `DELETE FROM webapp_api_keys
        WHERE id = $1 AND ($2::text IS NULL OR empresa_cnpj = $2)
        RETURNING nome, key_prefix, ativa`,
      [id, cnpj],
    );
    const row = r.rows[0];
    if (!row) return null;
    return { nome: row.nome, prefixo: row.key_prefix, estavaAtiva: row.ativa };
  }

  /** Apaga de uma vez as chaves já revogadas da empresa. Devolve quantas saíram. */
  async excluirRevogadas(empresaCnpj: string): Promise<number> {
    const r = await this.pool.query(
      `DELETE FROM webapp_api_keys WHERE empresa_cnpj = $1 AND ativa = FALSE`,
      [empresaCnpj.replace(/\D/g, '')],
    );
    return r.rowCount ?? 0;
  }

  /** Revoga todas as chaves de uma empresa (usado ao remover a empresa). */
  async revogarTodas(empresaCnpj: string): Promise<void> {
    await this.pool.query(
      `UPDATE webapp_api_keys SET ativa = FALSE, revogada_em = NOW()
        WHERE empresa_cnpj = $1 AND ativa = TRUE`,
      [empresaCnpj.replace(/\D/g, '')],
    );
  }
}
