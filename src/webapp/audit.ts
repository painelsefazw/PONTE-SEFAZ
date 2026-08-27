import { Pool } from 'pg';

export interface AuditEntry {
  id?: number;
  actor: string;
  empresaCnpj?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  requestId?: string;
  createdAt?: string;
}

export class AuditStore {
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
      CREATE TABLE IF NOT EXISTS webapp_audit_log (
        id SERIAL PRIMARY KEY,
        actor TEXT NOT NULL,
        empresa_cnpj VARCHAR(14),
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        before_data JSONB,
        after_data JSONB,
        metadata JSONB,
        request_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_audit_empresa ON webapp_audit_log (empresa_cnpj, created_at DESC)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_audit_action ON webapp_audit_log (action, created_at DESC)`,
    );
    this.initialized = true;
  }

  async registrar(entry: AuditEntry): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO webapp_audit_log
          (actor, empresa_cnpj, action, entity_type, entity_id, before_data, after_data, metadata, request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          entry.actor,
          entry.empresaCnpj || null,
          entry.action,
          entry.entityType,
          entry.entityId || null,
          entry.before ? JSON.stringify(entry.before) : null,
          entry.after ? JSON.stringify(entry.after) : null,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
          entry.requestId || null,
        ],
      );
    } catch {
      // audit never blocks the operation
    }
  }

  async listar(filtros: {
    empresaCnpj?: string;
    action?: string;
    entityType?: string;
    desde?: string;
    ate?: string;
    limite?: number;
    offset?: number;
  }): Promise<{ entries: AuditEntry[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filtros.empresaCnpj) {
      conditions.push(`empresa_cnpj = $${idx++}`);
      params.push(filtros.empresaCnpj.replace(/\D/g, ''));
    }
    if (filtros.action) {
      conditions.push(`action = $${idx++}`);
      params.push(filtros.action);
    }
    if (filtros.entityType) {
      conditions.push(`entity_type = $${idx++}`);
      params.push(filtros.entityType);
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

    const countR = await this.pool.query(`SELECT COUNT(*) FROM webapp_audit_log ${where}`, params);
    const total = parseInt(countR.rows[0].count, 10);

    const r = await this.pool.query(
      `SELECT * FROM webapp_audit_log ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limite, offset],
    );

    return {
      total,
      entries: r.rows.map((row: any) => ({
        id: row.id,
        actor: row.actor,
        empresaCnpj: row.empresa_cnpj,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        before: row.before_data,
        after: row.after_data,
        metadata: row.metadata,
        requestId: row.request_id,
        createdAt: row.created_at,
      })),
    };
  }
}
