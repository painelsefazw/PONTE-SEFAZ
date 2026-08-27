import { Pool } from 'pg';

export type FiscalService = 'nfe' | 'nfce' | 'nfse' | 'cte' | 'mdfe';

export interface ClientService {
  id?: number;
  empresaCnpj: string;
  service: FiscalService;
  active: boolean;
  configuration?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export type ApiScope =
  | 'nfe:read' | 'nfe:write' | 'nfe:cancel'
  | 'nfce:read' | 'nfce:write' | 'nfce:cancel'
  | 'nfse:read' | 'nfse:write' | 'nfse:cancel'
  | 'documents:download' | 'webhooks:manage'
  | 'full';

const SERVICE_SCOPES: Record<FiscalService, ApiScope[]> = {
  nfe:  ['nfe:read', 'nfe:write', 'nfe:cancel'],
  nfce: ['nfce:read', 'nfce:write', 'nfce:cancel'],
  nfse: ['nfse:read', 'nfse:write', 'nfse:cancel'],
  cte:  [],
  mdfe: [],
};

export function scopeAllowsService(scopes: ApiScope[], service: FiscalService, operation: 'read' | 'write' | 'cancel'): boolean {
  if (scopes.includes('full')) return true;
  const required = `${service}:${operation}` as ApiScope;
  return scopes.includes(required);
}

export function scopeAllowsAction(scopes: ApiScope[], action: ApiScope): boolean {
  if (scopes.includes('full')) return true;
  return scopes.includes(action);
}

export class ClientServiceStore {
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
      CREATE TABLE IF NOT EXISTS webapp_client_services (
        id SERIAL PRIMARY KEY,
        empresa_cnpj VARCHAR(14) NOT NULL,
        service VARCHAR(20) NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        configuration JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(empresa_cnpj, service)
      )
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_client_svc_empresa ON webapp_client_services (empresa_cnpj)`,
    );
    this.initialized = true;
  }

  async listar(empresaCnpj: string): Promise<ClientService[]> {
    const r = await this.pool.query(
      `SELECT * FROM webapp_client_services WHERE empresa_cnpj = $1 ORDER BY service`,
      [empresaCnpj.replace(/\D/g, '')],
    );
    return r.rows.map(this.mapRow);
  }

  async obterAtivos(empresaCnpj: string): Promise<FiscalService[]> {
    const r = await this.pool.query(
      `SELECT service FROM webapp_client_services WHERE empresa_cnpj = $1 AND active = TRUE`,
      [empresaCnpj.replace(/\D/g, '')],
    );
    return r.rows.map((row: any) => row.service as FiscalService);
  }

  async ativar(empresaCnpj: string, service: FiscalService, configuration?: Record<string, unknown>): Promise<void> {
    const cnpj = empresaCnpj.replace(/\D/g, '');
    await this.pool.query(
      `INSERT INTO webapp_client_services (empresa_cnpj, service, active, configuration)
       VALUES ($1, $2, TRUE, $3)
       ON CONFLICT (empresa_cnpj, service)
       DO UPDATE SET active = TRUE, configuration = COALESCE($3, webapp_client_services.configuration), updated_at = NOW()`,
      [cnpj, service, configuration ? JSON.stringify(configuration) : null],
    );
  }

  async desativar(empresaCnpj: string, service: FiscalService): Promise<void> {
    await this.pool.query(
      `UPDATE webapp_client_services SET active = FALSE, updated_at = NOW()
       WHERE empresa_cnpj = $1 AND service = $2`,
      [empresaCnpj.replace(/\D/g, ''), service],
    );
  }

  async verificarPermissao(empresaCnpj: string, service: FiscalService): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT active FROM webapp_client_services WHERE empresa_cnpj = $1 AND service = $2`,
      [empresaCnpj.replace(/\D/g, ''), service],
    );
    return r.rows.length > 0 && r.rows[0].active === true;
  }

  async scopesPermitidos(empresaCnpj: string): Promise<ApiScope[]> {
    const ativos = await this.obterAtivos(empresaCnpj);
    const scopes: ApiScope[] = ['documents:download'];
    for (const svc of ativos) {
      scopes.push(...(SERVICE_SCOPES[svc] || []));
    }
    return scopes;
  }

  private mapRow(row: any): ClientService {
    return {
      id: row.id,
      empresaCnpj: row.empresa_cnpj,
      service: row.service,
      active: row.active,
      configuration: row.configuration,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
