import { Pool } from 'pg';
import * as crypto from 'crypto';

export type WebhookEvent =
  | 'nfe.authorized' | 'nfe.rejected' | 'nfe.cancelled'
  | 'nfce.authorized' | 'nfce.rejected' | 'nfce.cancelled'
  | 'nfse.authorized' | 'nfse.rejected' | 'nfse.cancelled';

export const ALL_WEBHOOK_EVENTS: WebhookEvent[] = [
  'nfe.authorized', 'nfe.rejected', 'nfe.cancelled',
  'nfce.authorized', 'nfce.rejected', 'nfce.cancelled',
  'nfse.authorized', 'nfse.rejected', 'nfse.cancelled',
];

export interface WebhookEndpoint {
  id?: number;
  empresaCnpj: string;
  url: string;
  events: WebhookEvent[];
  secret: string;
  active: boolean;
  ambiente?: string;
  createdAt?: string;
}

export interface WebhookDelivery {
  id?: number;
  endpointId: number;
  event: string;
  payload: Record<string, unknown>;
  statusCode?: number;
  responseBody?: string;
  attempts: number;
  success: boolean;
  nextRetryAt?: string;
  createdAt?: string;
}

function signPayload(payload: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export class WebhookStore {
  private pool: Pool;
  private initialized = false;

  constructor(poolOrUrl: Pool | string) {
    if (typeof poolOrUrl === 'string') {
      const isLocal = /localhost|127\.0\.0\.1/.test(poolOrUrl);
      this.pool = new Pool({
        connectionString: poolOrUrl,
        ssl: isLocal ? undefined : { rejectUnauthorized: false },
        max: 2,
      });
    } else {
      this.pool = poolOrUrl;
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_webhook_endpoints (
        id SERIAL PRIMARY KEY,
        empresa_cnpj VARCHAR(14) NOT NULL,
        url TEXT NOT NULL,
        events TEXT[] NOT NULL DEFAULT '{}',
        secret TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        ambiente VARCHAR(1),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_webhook_empresa ON webapp_webhook_endpoints (empresa_cnpj)`,
    );
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_webhook_deliveries (
        id SERIAL PRIMARY KEY,
        endpoint_id INTEGER NOT NULL REFERENCES webapp_webhook_endpoints(id) ON DELETE CASCADE,
        event TEXT NOT NULL,
        payload JSONB NOT NULL,
        status_code SMALLINT,
        response_body TEXT,
        attempts SMALLINT NOT NULL DEFAULT 1,
        success BOOLEAN NOT NULL DEFAULT FALSE,
        next_retry_at TIMESTAMPTZ,
        -- Quantas vezes ja foi tentada. Sem isso o reenvio nao sabe quando
        -- desistir, e um endpoint morto seria tentado para sempre.
        tentativas INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_webhook_del_endpoint ON webapp_webhook_deliveries (endpoint_id, created_at DESC)`,
    );
    // Tabela que já existe não ganha coluna pelo CREATE acima.
    await this.pool.query(
      `ALTER TABLE webapp_webhook_deliveries ADD COLUMN IF NOT EXISTS tentativas INTEGER NOT NULL DEFAULT 1`,
    ).catch(() => {});
    // O reprocessamento varre por (success, next_retry_at); sem índice ele faz
    // varredura completa numa tabela que só cresce.
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_webhook_del_retry
         ON webapp_webhook_deliveries (next_retry_at)
       WHERE success = FALSE AND next_retry_at IS NOT NULL`,
    ).catch(() => {});
    this.initialized = true;
  }

  async criar(ep: { empresaCnpj: string; url: string; events: WebhookEvent[]; ambiente?: string }): Promise<WebhookEndpoint> {
    const secret = 'whsec_' + crypto.randomBytes(24).toString('base64url');
    const r = await this.pool.query(
      `INSERT INTO webapp_webhook_endpoints (empresa_cnpj, url, events, secret, ambiente)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [ep.empresaCnpj.replace(/\D/g, ''), ep.url, ep.events, secret, ep.ambiente || null],
    );
    return this.mapEndpoint(r.rows[0]);
  }

  async listar(empresaCnpj: string): Promise<WebhookEndpoint[]> {
    const r = await this.pool.query(
      `SELECT * FROM webapp_webhook_endpoints WHERE empresa_cnpj = $1 ORDER BY created_at DESC`,
      [empresaCnpj.replace(/\D/g, '')],
    );
    return r.rows.map(this.mapEndpoint);
  }

  async atualizar(id: number, data: { url?: string; events?: WebhookEvent[]; active?: boolean }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (data.url !== undefined) { sets.push(`url = $${idx++}`); params.push(data.url); }
    if (data.events !== undefined) { sets.push(`events = $${idx++}`); params.push(data.events); }
    if (data.active !== undefined) { sets.push(`active = $${idx++}`); params.push(data.active); }
    if (!sets.length) return;
    params.push(id);
    await this.pool.query(`UPDATE webapp_webhook_endpoints SET ${sets.join(', ')} WHERE id = $${idx}`, params);
  }

  async excluir(id: number, empresaCnpj: string): Promise<boolean> {
    const r = await this.pool.query(
      `DELETE FROM webapp_webhook_endpoints WHERE id = $1 AND empresa_cnpj = $2`,
      [id, empresaCnpj.replace(/\D/g, '')],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * @param ambiente '1' producao, '2' homologacao. O endpoint cadastrado SEM
   *   ambiente recebe os dois; com ambiente, so o dele.
   *
   *   A coluna existia, o cadastro a aceitava e a consulta a ignorava: nota de
   *   teste disparava o mesmo `nfe.authorized` que nota real, e o ERP do cliente
   *   dava baixa em pedido, mandava e-mail e movimentava estoque por causa de
   *   uma homologacao. O ambiente tambem passou a viajar no payload, porque quem
   *   ja recebe hoje precisa conseguir distinguir sem consultar nada.
   */
  async despachar(
    empresaCnpj: string,
    event: WebhookEvent,
    payload: Record<string, unknown>,
    ambiente?: string,
  ): Promise<void> {
    const cnpj = empresaCnpj.replace(/\D/g, '');
    const endpoints = await this.pool.query(
      `SELECT * FROM webapp_webhook_endpoints
       WHERE empresa_cnpj = $1 AND active = TRUE AND $2 = ANY(events)
         AND (ambiente IS NULL OR $3::text IS NULL OR ambiente = $3)`,
      [cnpj, event, ambiente ?? null],
    );

    for (const ep of endpoints.rows) {
      const body = JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        ...(ambiente ? { ambiente } : {}),
        data: payload,
      });
      const r = await this.entregar(ep, body, event);

      // `next_retry_at` era gravado e NUNCA lido: existia a aparencia do retry
      // e nenhum reenvio. Agora ele so e preenchido quando ha reprocessamento
      // possivel, e `reprocessarPendentes()` e quem o consome.
      //
      // Falha 4xx (fora 408 e 429) nao volta a ser tentada: o endpoint do
      // cliente recusou o formato, e repetir a mesma coisa mil vezes so enche
      // o log dos dois lados.
      const valeTentar = !r.success && r.statusCode !== undefined
        ? r.statusCode >= 500 || r.statusCode === 408 || r.statusCode === 429
        : !r.success; // erro de rede: vale tentar
      const retryAt = valeTentar ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;

      await this.pool.query(
        `INSERT INTO webapp_webhook_deliveries
          (endpoint_id, event, payload, status_code, response_body, success, next_retry_at, tentativas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
        [ep.id, event, JSON.stringify(payload), r.statusCode || null, r.responseBody || null, r.success, retryAt],
      ).catch(() => {});
    }
  }

  /** Um POST assinado. Separado para o reenvio usar exatamente o mesmo caminho. */
  private async entregar(
    ep: { url: string; secret: string },
    body: string,
    event: string,
  ): Promise<{ success: boolean; statusCode?: number; responseBody?: string }> {
    const signature = signPayload(body, ep.secret);
    try {
      const axios = require('axios');
      const resp = await axios.post(ep.url, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': event,
        },
        timeout: 10000,
        validateStatus: () => true,
      });
      const statusCode: number = resp.status;
      const responseBody = typeof resp.data === 'string'
        ? resp.data.slice(0, 500)
        : JSON.stringify(resp.data).slice(0, 500);
      return { success: statusCode >= 200 && statusCode < 300, statusCode, responseBody };
    } catch (err: any) {
      return { success: false, responseBody: err.message?.slice(0, 500) };
    }
  }

  /**
   * Reenvia as entregas vencidas. E o que faltava para o retry existir.
   *
   * Chamada por `POST /api/admin/webhooks/reprocessar` — de um cron, de um
   * monitor ou a mao. Em serverless nao ha processo de fundo: um `setInterval`
   * morreria com a invocacao, e por isso o gatilho e uma rota.
   *
   * Para de tentar em `maxTentativas` — endpoint que nao responde em 5 tentativas
   * espalhadas por horas nao vai responder na sexta, e insistir vira ruido.
   */
  async reprocessarPendentes(limite = 50, maxTentativas = 5): Promise<{ reenviadas: number; sucesso: number; desistidas: number }> {
    const pend = await this.pool.query(
      `SELECT d.*, e.url, e.secret, e.active
         FROM webapp_webhook_deliveries d
         JOIN webapp_webhook_endpoints e ON e.id = d.endpoint_id
        WHERE d.success = FALSE
          AND d.next_retry_at IS NOT NULL
          AND d.next_retry_at <= NOW()
          AND e.active = TRUE
        ORDER BY d.next_retry_at ASC
        LIMIT $1`,
      [limite],
    );

    let sucesso = 0;
    let desistidas = 0;
    for (const row of pend.rows) {
      const tentativas = Number(row.tentativas || 1) + 1;
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      const body = JSON.stringify({ event: row.event, timestamp: new Date().toISOString(), data: payload });
      const r = await this.entregar({ url: row.url, secret: row.secret }, body, row.event);

      if (r.success) sucesso++;
      const desistir = !r.success && tentativas >= maxTentativas;
      if (desistir) desistidas++;

      // Espera crescente: 5, 10, 20, 40 minutos. Endpoint que caiu costuma
      // voltar, e martelar de 5 em 5 minutos so atrapalha quem esta subindo.
      const proximo = r.success || desistir
        ? null
        : new Date(Date.now() + 5 * 60 * 1000 * Math.pow(2, tentativas - 1)).toISOString();

      await this.pool.query(
        `UPDATE webapp_webhook_deliveries
            SET success = $2, status_code = $3, response_body = $4,
                next_retry_at = $5, tentativas = $6
          WHERE id = $1`,
        [row.id, r.success, r.statusCode || null, r.responseBody || null, proximo, tentativas],
      ).catch(() => {});
    }

    return { reenviadas: pend.rows.length, sucesso, desistidas };
  }

  async listarEntregas(endpointId: number, limite = 20): Promise<WebhookDelivery[]> {
    const r = await this.pool.query(
      `SELECT * FROM webapp_webhook_deliveries WHERE endpoint_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [endpointId, limite],
    );
    return r.rows.map((row: any) => ({
      id: row.id,
      endpointId: row.endpoint_id,
      event: row.event,
      payload: row.payload,
      statusCode: row.status_code,
      responseBody: row.response_body,
      attempts: row.attempts,
      success: row.success,
      nextRetryAt: row.next_retry_at,
      createdAt: row.created_at,
    }));
  }

  async estatisticas(empresaCnpj: string): Promise<{ total: number; sucesso: number; falha: number; taxaSucesso: number }> {
    const r = await this.pool.query(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE d.success = TRUE) as sucesso,
              COUNT(*) FILTER (WHERE d.success = FALSE) as falha
       FROM webapp_webhook_deliveries d
       JOIN webapp_webhook_endpoints e ON e.id = d.endpoint_id
       WHERE e.empresa_cnpj = $1 AND d.created_at >= NOW() - INTERVAL '30 days'`,
      [empresaCnpj.replace(/\D/g, '')],
    );
    const row = r.rows[0];
    const total = +row.total;
    return {
      total,
      sucesso: +row.sucesso,
      falha: +row.falha,
      taxaSucesso: total > 0 ? Math.round((+row.sucesso / total) * 1000) / 10 : 100,
    };
  }

  private mapEndpoint(row: any): WebhookEndpoint {
    return {
      id: row.id,
      empresaCnpj: row.empresa_cnpj,
      url: row.url,
      events: row.events,
      secret: row.secret,
      active: row.active,
      ambiente: row.ambiente,
      createdAt: row.created_at,
    };
  }
}
