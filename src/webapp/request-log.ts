import { Pool } from 'pg';

export interface RequestLogEntry {
  requestId: string;
  empresaCnpj?: string;
  apiKeyPrefix?: string;
  method: string;
  path: string;
  service?: string;
  statusCode: number;
  durationMs: number;
  ambiente?: string;
  errorCode?: string;
  errorMessage?: string;
  ip?: string;
  userAgent?: string;
}

export class RequestLogStore {
  private pool: Pool;
  private initialized = false;
  private queue: RequestLogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

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
      CREATE TABLE IF NOT EXISTS webapp_request_log (
        id SERIAL PRIMARY KEY,
        request_id TEXT NOT NULL,
        empresa_cnpj VARCHAR(14),
        api_key_prefix VARCHAR(32),
        method VARCHAR(10) NOT NULL,
        path TEXT NOT NULL,
        service VARCHAR(20),
        status_code SMALLINT NOT NULL,
        duration_ms INTEGER NOT NULL,
        ambiente VARCHAR(1),
        error_code TEXT,
        error_message TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_reqlog_empresa ON webapp_request_log (empresa_cnpj, created_at DESC)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_reqlog_created ON webapp_request_log (created_at DESC)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_reqlog_request_id ON webapp_request_log (request_id)`,
    );
    this.initialized = true;

    this.flushTimer = setInterval(() => this.flush(), 5000);
  }

  enqueue(entry: RequestLogEntry): void {
    this.queue.push(entry);
    if (this.queue.length >= 20) this.flush();
  }

  private flush(): void {
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, 50);
    const values: unknown[] = [];
    const rows: string[] = [];
    let idx = 1;
    for (const e of batch) {
      rows.push(
        `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`,
      );
      values.push(
        e.requestId, e.empresaCnpj || null, e.apiKeyPrefix || null,
        e.method, e.path, e.service || null,
        e.statusCode, e.durationMs, e.ambiente || null,
        e.errorCode || null, e.errorMessage || null, e.ip || null,
      );
    }
    this.pool.query(
      `INSERT INTO webapp_request_log
        (request_id, empresa_cnpj, api_key_prefix, method, path, service, status_code, duration_ms, ambiente, error_code, error_message, ip)
       VALUES ${rows.join(',')}`,
      values,
    ).catch(() => {});
  }

  async listar(filtros: {
    empresaCnpj?: string;
    service?: string;
    statusCode?: number;
    errorOnly?: boolean;
    desde?: string;
    ate?: string;
    limite?: number;
    offset?: number;
  }): Promise<{ entries: RequestLogEntry[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filtros.empresaCnpj) {
      conditions.push(`empresa_cnpj = $${idx++}`);
      params.push(filtros.empresaCnpj.replace(/\D/g, ''));
    }
    if (filtros.service) {
      conditions.push(`service = $${idx++}`);
      params.push(filtros.service);
    }
    if (filtros.errorOnly) {
      conditions.push(`status_code >= 400`);
    }
    if (filtros.statusCode) {
      conditions.push(`status_code = $${idx++}`);
      params.push(filtros.statusCode);
    }
    if (filtros.desde) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(filtros.desde);
    }
    if (filtros.ate) {
      conditions.push(`created_at <= $${idx++}`);
      params.push(filtros.ate);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const limite = Math.min(filtros.limite || 50, 200);
    const offset = filtros.offset || 0;

    const countR = await this.pool.query(`SELECT COUNT(*) FROM webapp_request_log ${where}`, params);
    const total = parseInt(countR.rows[0].count, 10);

    const r = await this.pool.query(
      `SELECT * FROM webapp_request_log ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limite, offset],
    );

    return {
      total,
      entries: r.rows.map((row: any) => ({
        requestId: row.request_id,
        empresaCnpj: row.empresa_cnpj,
        apiKeyPrefix: row.api_key_prefix,
        method: row.method,
        path: row.path,
        service: row.service,
        statusCode: row.status_code,
        durationMs: row.duration_ms,
        ambiente: row.ambiente,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        ip: row.ip,
        userAgent: row.user_agent,
      })),
    };
  }

  async estatisticas(empresaCnpj: string): Promise<{
    hoje: { total: number; erros: number; latenciaMedia: number };
    mes: { total: number; erros: number; emissoes: number };
  }> {
    const cnpj = empresaCnpj.replace(/\D/g, '');
    const hojeR = await this.pool.query(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE status_code >= 400) as erros,
              COALESCE(AVG(duration_ms), 0) as latencia
       FROM webapp_request_log
       WHERE empresa_cnpj = $1 AND created_at >= CURRENT_DATE`,
      [cnpj],
    );
    const mesR = await this.pool.query(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE status_code >= 400) as erros,
              COUNT(*) FILTER (WHERE path LIKE '%/emitir%' AND status_code < 400) as emissoes
       FROM webapp_request_log
       WHERE empresa_cnpj = $1 AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
      [cnpj],
    );
    const h = hojeR.rows[0];
    const m = mesR.rows[0];
    return {
      hoje: { total: +h.total, erros: +h.erros, latenciaMedia: Math.round(+h.latencia) },
      mes: { total: +m.total, erros: +m.erros, emissoes: +m.emissoes },
    };
  }

  destroy(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flush();
  }
}
