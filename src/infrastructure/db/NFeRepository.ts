/**
 * Repositorio PostgreSQL para persistencia de NF-e.
 * Utiliza exclusivamente queries parametrizadas ($1, $2, ...).
 */

import { Pool, PoolClient } from 'pg';
import { CREATE_TABLE_SQL, NFeStatus } from './migrations';

// ============================================================================
// Interface do registro NF-e (camelCase, espelhando a tabela)
// ============================================================================

export interface NFeRecord {
  id: number;
  chaveAcesso: string;
  numero: string;
  serie: string;
  cnpjEmitente: string;
  ambiente: string;
  status: string;
  cstat: string | null;
  xmotivo: string | null;
  nprot: string | null;
  xmlEnviado: string;
  xmlRetorno: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Repositorio
// ============================================================================

export class NFeRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Cria a tabela e indices caso nao existam.
   */
  async initialize(): Promise<void> {
    await this.pool.query(CREATE_TABLE_SQL);
  }

  /**
   * Insere uma nova NF-e na base e retorna o id gerado.
   * Utiliza query parametrizada para prevenir SQL injection.
   */
  async save(data: {
    chaveAcesso: string;
    numero: string;
    serie: string;
    cnpjEmitente: string;
    ambiente: string;
    xmlEnviado: string;
  }): Promise<number> {
    const sql = `
      INSERT INTO nfe (chave_acesso, numero, serie, cnpj_emitente, ambiente, xml_enviado)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;

    const result = await this.pool.query(sql, [
      data.chaveAcesso,
      data.numero,
      data.serie,
      data.cnpjEmitente,
      data.ambiente,
      data.xmlEnviado,
    ]);

    return result.rows[0].id as number;
  }

  /**
   * Atualiza o status de uma NF-e identificada pela chave de acesso.
   * Campos extras (cstat, xmotivo, nprot, xmlRetorno) sao opcionais.
   */
  async updateStatus(
    chaveAcesso: string,
    status: NFeStatus,
    extra?: {
      cstat?: string;
      xmotivo?: string;
      nprot?: string;
      xmlRetorno?: string;
    },
  ): Promise<void> {
    const sql = `
      UPDATE nfe
      SET status = $1,
          cstat = COALESCE($2, cstat),
          xmotivo = COALESCE($3, xmotivo),
          nprot = COALESCE($4, nprot),
          xml_retorno = COALESCE($5, xml_retorno),
          updated_at = NOW()
      WHERE chave_acesso = $6
    `;

    await this.pool.query(sql, [
      status,
      extra?.cstat ?? null,
      extra?.xmotivo ?? null,
      extra?.nprot ?? null,
      extra?.xmlRetorno ?? null,
      chaveAcesso,
    ]);
  }

  /**
   * Busca uma NF-e pela chave de acesso (44 digitos).
   * Retorna null se nao encontrada.
   */
  async findByChave(chaveAcesso: string): Promise<NFeRecord | null> {
    const sql = `SELECT * FROM nfe WHERE chave_acesso = $1`;
    const result = await this.pool.query(sql, [chaveAcesso]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * Busca NF-e por CNPJ do emitente, ordenadas da mais recente para a mais antiga.
   *
   * @param cnpjEmitente - CNPJ do emitente (14 digitos, sem formatacao)
   * @param limit - Numero maximo de registros (default: 50)
   */
  async findByEmitente(cnpjEmitente: string, limit?: number): Promise<NFeRecord[]> {
    const maxRows = limit ?? 50;
    const sql = `
      SELECT * FROM nfe
      WHERE cnpj_emitente = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    const result = await this.pool.query(sql, [cnpjEmitente, maxRows]);
    return result.rows.map((row: Record<string, unknown>) => this.mapRow(row));
  }

  /**
   * Executa uma funcao dentro de uma transacao PostgreSQL.
   * Faz BEGIN antes, COMMIT ao final, e ROLLBACK em caso de erro.
   * O client e sempre liberado no bloco finally.
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Mapeia uma row do PostgreSQL (snake_case) para NFeRecord (camelCase).
   */
  private mapRow(row: Record<string, unknown>): NFeRecord {
    return {
      id: row.id as number,
      chaveAcesso: row.chave_acesso as string,
      numero: row.numero as string,
      serie: row.serie as string,
      cnpjEmitente: row.cnpj_emitente as string,
      ambiente: row.ambiente as string,
      status: row.status as string,
      cstat: (row.cstat as string) ?? null,
      xmotivo: (row.xmotivo as string) ?? null,
      nprot: (row.nprot as string) ?? null,
      xmlEnviado: row.xml_enviado as string,
      xmlRetorno: (row.xml_retorno as string) ?? null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }
}
