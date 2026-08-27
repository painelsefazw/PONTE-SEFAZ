import { Pool } from 'pg';
import type { FiscalService } from './client-services';
import type { WhiteLabelConfig } from './white-label';

export type TemplateStatus = 'draft' | 'published' | 'deprecated';

export interface PlatformTemplate {
  id?: number;
  name: string;
  slug: string;
  version: string;
  status: TemplateStatus;
  description?: string;
  supportedModules: FiscalService[];
  manifestSchemaVersion: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
}

export interface PlatformGeneration {
  id?: number;
  empresaCnpj: string;
  templateId: number;
  templateVersion: string;
  manifestVersion: string;
  brandingSnapshot: Record<string, unknown>;
  modulesSnapshot: FiscalService[];
  featuresSnapshot: Record<string, boolean>;
  generatedBy: string;
  createdAt?: string;
}

export interface PlatformManifest {
  schemaVersion: string;
  project: {
    type: string;
    template: string;
    templateVersion: string;
  };
  company: {
    id: string;
    name: string;
    brandName: string;
    cnpj: string;
    /** UF do emitente: decide operacao interna (CFOP 5xxx) ou interestadual (6xxx). */
    uf: string;
  };
  branding: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    muted: string;
    theme: string;
    border?: string;
    radius?: string;
    logoUrl?: string;
    logoDarkUrl?: string;
    faviconUrl?: string;
  };
  /** Logo e favicon do cliente, como data URI. Vao no kit para nao depender de nos. */
  assets?: {
    logo?: string;
    logoDark?: string;
    favicon?: string;
  };
  modules: Record<string, boolean>;
  features: Record<string, boolean>;
  api: {
    baseUrl: string;
    clientId: string;
    tenantId: string;
    secret: string;
  };
  support?: {
    email?: string;
    phone?: string;
    whatsapp?: string;
    site?: string;
  };
  legal?: {
    termsUrl?: string;
    privacyUrl?: string;
  };
  ui?: {
    loginMessage?: string;
    browserTitle?: string;
    footer?: string;
  };
}

const TEMPLATE_PADRAO_CONTENT = `## Estrutura esperada da plataforma

- Layout com barra lateral fixa (desktop) e menu inferior (mobile).
- Dashboard inicial com totais do mes: emitidas, canceladas, rejeitadas e valor total.
- Listagem de notas com busca por numero/destinatario, filtro por status e periodo.
- Formulario de emissao com validacao antes do envio e resumo de impostos.
- Tela de detalhe da nota com DANFE (PDF), XML e acoes de cancelar/corrigir.
- Area de configuracoes com dados da empresa e certificado (somente leitura).

## Padroes de codigo

- React + TypeScript + Tailwind, componentes funcionais.
- Toda chamada a API passa por uma camada server-side (Edge Function/BFF).
- Cores exclusivamente via CSS variables definidas pelo manifest.
- Formatacao brasileira: moeda BRL, datas dd/MM/yyyy, CNPJ e CPF mascarados.`;

export class PlatformTemplateStore {
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
      CREATE TABLE IF NOT EXISTS webapp_platform_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        version TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        description TEXT,
        supported_modules TEXT[] NOT NULL DEFAULT '{}',
        manifest_schema_version TEXT NOT NULL DEFAULT '1.0',
        content TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at TIMESTAMPTZ,
        UNIQUE(slug, version)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_platform_generations (
        id SERIAL PRIMARY KEY,
        empresa_cnpj VARCHAR(14) NOT NULL,
        template_id INTEGER NOT NULL REFERENCES webapp_platform_templates(id),
        template_version TEXT NOT NULL,
        manifest_version TEXT NOT NULL DEFAULT '1.0',
        branding_snapshot JSONB,
        modules_snapshot TEXT[] NOT NULL DEFAULT '{}',
        features_snapshot JSONB,
        generated_by TEXT NOT NULL DEFAULT 'admin',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_gen_empresa ON webapp_platform_generations (empresa_cnpj, created_at DESC)`,
    );
    await this.seedPadrao();
    this.initialized = true;
  }

  /**
   * Garante que o template padrão 'fiscal-platform' exista e esteja publicado.
   * Sem ele o "Gerar Kit" abre com o seletor vazio e não há como avançar.
   */
  private async seedPadrao(): Promise<void> {
    await this.pool.query(
      `INSERT INTO webapp_platform_templates
        (name, slug, version, status, description, supported_modules, content, published_at)
       VALUES ($1, $2, $3, 'published', $4, $5, $6, NOW())
       ON CONFLICT (slug, version) DO NOTHING`,
      [
        'Plataforma Fiscal (padrao)',
        'fiscal-platform',
        '1.0',
        'Template padrao de plataforma fiscal white-label. Cobre NF-e, NFC-e e NFS-e.',
        ['nfe', 'nfce', 'nfse'],
        TEMPLATE_PADRAO_CONTENT,
      ],
    ).catch(() => {});
  }

  /**
   * Cria já publicado: um template em rascunho não aparece no seletor do
   * "Gerar Kit", e o passo extra de publicar só gerava confusão.
   */
  async criarTemplate(tpl: {
    name: string; slug: string; version: string; description?: string;
    supportedModules: FiscalService[]; content?: string;
  }): Promise<PlatformTemplate> {
    const r = await this.pool.query(
      `INSERT INTO webapp_platform_templates
        (name, slug, version, status, description, supported_modules, content, published_at)
       VALUES ($1, $2, $3, 'published', $4, $5, $6, NOW()) RETURNING *`,
      [
        tpl.name, tpl.slug, tpl.version, tpl.description || null,
        tpl.supportedModules?.length ? tpl.supportedModules : ['nfe'],
        tpl.content || TEMPLATE_PADRAO_CONTENT,
      ],
    );
    return this.mapTemplate(r.rows[0]);
  }

  async publicar(id: number): Promise<void> {
    await this.pool.query(
      `UPDATE webapp_platform_templates SET status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  async listarTemplates(status?: TemplateStatus): Promise<PlatformTemplate[]> {
    const where = status ? 'WHERE status = $1' : '';
    const params = status ? [status] : [];
    const r = await this.pool.query(
      `SELECT * FROM webapp_platform_templates ${where} ORDER BY name, version DESC`,
      params,
    );
    return r.rows.map(this.mapTemplate);
  }

  async obterTemplate(slug: string, version?: string): Promise<PlatformTemplate | null> {
    const r = version
      ? await this.pool.query(`SELECT * FROM webapp_platform_templates WHERE slug = $1 AND version = $2`, [slug, version])
      : await this.pool.query(`SELECT * FROM webapp_platform_templates WHERE slug = $1 AND status = 'published' ORDER BY version DESC LIMIT 1`, [slug]);
    return r.rows.length ? this.mapTemplate(r.rows[0]) : null;
  }

  async obterTemplatePorId(id: number): Promise<PlatformTemplate | null> {
    const r = await this.pool.query(`SELECT * FROM webapp_platform_templates WHERE id = $1`, [id]);
    return r.rows.length ? this.mapTemplate(r.rows[0]) : null;
  }

  async registrarGeracao(gen: {
    empresaCnpj: string; templateId: number; templateVersion: string;
    branding: WhiteLabelConfig; modules: FiscalService[];
    features: Record<string, boolean>; generatedBy: string;
  }): Promise<number> {
    const r = await this.pool.query(
      `INSERT INTO webapp_platform_generations
        (empresa_cnpj, template_id, template_version, branding_snapshot, modules_snapshot, features_snapshot, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        gen.empresaCnpj.replace(/\D/g, ''), gen.templateId, gen.templateVersion,
        JSON.stringify(gen.branding), gen.modules,
        JSON.stringify(gen.features), gen.generatedBy,
      ],
    );
    return r.rows[0].id;
  }

  async listarGeracoes(empresaCnpj: string): Promise<PlatformGeneration[]> {
    const r = await this.pool.query(
      `SELECT * FROM webapp_platform_generations WHERE empresa_cnpj = $1 ORDER BY created_at DESC`,
      [empresaCnpj.replace(/\D/g, '')],
    );
    return r.rows.map(this.mapGeneration);
  }

  gerarManifest(data: {
    empresa: { cnpj: string; razaoSocial: string; fantasia?: string; uf?: string };
    branding: WhiteLabelConfig;
    modules: FiscalService[];
    template: PlatformTemplate;
    apiBaseUrl: string;
    clientId: string;
  }): PlatformManifest {
    const moduleMap: Record<string, boolean> = {};
    for (const svc of ['nfe', 'nfce', 'nfse', 'cte', 'mdfe']) {
      moduleMap[svc] = data.modules.includes(svc as FiscalService);
    }
    return {
      schemaVersion: '1.0',
      project: {
        type: 'fiscal_white_label',
        template: data.template.slug,
        templateVersion: data.template.version,
      },
      company: {
        id: data.clientId,
        name: data.empresa.razaoSocial,
        brandName: data.branding.nomePlataforma || data.empresa.fantasia || data.empresa.razaoSocial,
        cnpj: data.empresa.cnpj,
        uf: (data.empresa.uf || '').toUpperCase(),
      },
      branding: {
        primary: data.branding.corPrimaria,
        secondary: data.branding.corSecundaria,
        accent: data.branding.corDestaque,
        background: data.branding.corBackground,
        surface: data.branding.corSurface,
        text: data.branding.corTexto,
        muted: data.branding.corMuted,
        theme: data.branding.tema,
        ...(data.branding.corBorda ? { border: data.branding.corBorda } : {}),
        ...(data.branding.borderRadius ? { radius: data.branding.borderRadius } : {}),
      },
      // Logo e favicon existiam no cadastro de marca e NUNCA saiam daqui: o kit
      // levava as cores do cliente e a marca dele ficava para tras, entao toda
      // plataforma gerada nascia sem logo nenhum. Vao como data URI porque o kit
      // e entregue solto — um link para a nossa API viraria dependencia externa
      // do site do cliente, e quebraria no dia em que o dominio mudasse.
      ...(data.branding.logoBase64 || data.branding.faviconBase64 ? {
        assets: {
          ...(data.branding.logoBase64 ? { logo: data.branding.logoBase64 } : {}),
          ...(data.branding.logoDarkBase64 ? { logoDark: data.branding.logoDarkBase64 } : {}),
          ...(data.branding.faviconBase64 ? { favicon: data.branding.faviconBase64 } : {}),
        },
      } : {}),
      modules: moduleMap,
      features: {
        dashboard: true,
        users: false,
        reports: true,
        support: true,
      },
      api: {
        baseUrl: data.apiBaseUrl || '{{API_BASE_URL}}',
        clientId: data.clientId || '{{CLIENT_ID}}',
        tenantId: data.empresa.cnpj,
        secret: '{{API_SECRET_SERVER_SIDE}}',
      },
      support: {
        email: data.branding.suporteEmail,
        phone: data.branding.suporteTelefone,
        whatsapp: data.branding.suporteWhatsapp,
        site: data.branding.suporteSite,
      },
      legal: {
        termsUrl: data.branding.termosUrl,
        privacyUrl: data.branding.privacidadeUrl,
      },
      ui: {
        loginMessage: data.branding.mensagemLogin,
        browserTitle: data.branding.tituloNavegador || data.branding.nomePlataforma,
        footer: data.branding.rodape,
      },
    };
  }

  private mapTemplate(row: any): PlatformTemplate {
    return {
      id: row.id, name: row.name, slug: row.slug, version: row.version,
      status: row.status, description: row.description,
      supportedModules: row.supported_modules, manifestSchemaVersion: row.manifest_schema_version,
      content: row.content,
      createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at,
    };
  }

  private mapGeneration(row: any): PlatformGeneration {
    return {
      id: row.id, empresaCnpj: row.empresa_cnpj, templateId: row.template_id,
      templateVersion: row.template_version, manifestVersion: row.manifest_version,
      brandingSnapshot: row.branding_snapshot, modulesSnapshot: row.modules_snapshot,
      featuresSnapshot: row.features_snapshot, generatedBy: row.generated_by,
      createdAt: row.created_at,
    };
  }
}
