import { Pool } from 'pg';

export interface WhiteLabelConfig {
  empresaCnpj: string;
  nomePlataforma: string;
  nomeExibicao?: string;
  corPrimaria: string;
  corSecundaria: string;
  corDestaque: string;
  corBackground: string;
  corSurface: string;
  corTexto: string;
  corMuted: string;
  corBorda?: string;
  borderRadius?: string;
  logoBase64?: string;
  logoDarkBase64?: string;
  faviconBase64?: string;
  suporteEmail?: string;
  suporteTelefone?: string;
  suporteWhatsapp?: string;
  suporteSite?: string;
  termosUrl?: string;
  privacidadeUrl?: string;
  dominioProducao?: string;
  mensagemLogin?: string;
  tituloNavegador?: string;
  rodape?: string;
  /**
   * `auto` saiu: ele seguia o sistema de quem visita, e a plataforma do cliente
   * mudava de cara conforme o aparelho do visitante. Cadastro antigo com `auto`
   * continua sendo lido — vira `light` na leitura, e nao quebra.
   */
  tema: 'light' | 'dark';
  atualizadoEm?: string;
}

const DEFAULT_CONFIG: Omit<WhiteLabelConfig, 'empresaCnpj'> = {
  // Vazio, e nao "Emissor Fiscal". O nome do NOSSO produto no lugar do nome do
  // cliente aparecia na barra lateral, no titulo da aba e na tela de
  // configuracoes da plataforma dele. Vazio aqui faz o gerador cair na fantasia
  // e depois na razao social — que sao, sempre, o nome certo.
  nomePlataforma: '',
  corPrimaria: '#6366f1',
  corSecundaria: '#1a1a2e',
  corDestaque: '#f59e0b',
  corBackground: '#f0f2f5',
  corSurface: '#ffffff',
  corTexto: '#1a1a2e',
  corMuted: '#6b7280',
  tema: 'light',
};

export class WhiteLabelStore {
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
      CREATE TABLE IF NOT EXISTS webapp_white_label (
        empresa_cnpj VARCHAR(14) PRIMARY KEY,
        nome_plataforma TEXT NOT NULL DEFAULT '',
        nome_exibicao TEXT,
        cor_primaria VARCHAR(9) NOT NULL DEFAULT '#6366f1',
        cor_secundaria VARCHAR(9) NOT NULL DEFAULT '#1a1a2e',
        cor_destaque VARCHAR(9) NOT NULL DEFAULT '#f59e0b',
        cor_background VARCHAR(9) NOT NULL DEFAULT '#f0f2f5',
        cor_surface VARCHAR(9) NOT NULL DEFAULT '#ffffff',
        cor_texto VARCHAR(9) NOT NULL DEFAULT '#1a1a2e',
        cor_muted VARCHAR(9) NOT NULL DEFAULT '#6b7280',
        cor_borda VARCHAR(9),
        border_radius VARCHAR(10),
        logo_base64 TEXT,
        logo_dark_base64 TEXT,
        favicon_base64 TEXT,
        suporte_email TEXT,
        suporte_telefone TEXT,
        suporte_whatsapp TEXT,
        suporte_site TEXT,
        termos_url TEXT,
        privacidade_url TEXT,
        dominio_producao TEXT,
        mensagem_login TEXT,
        titulo_navegador TEXT,
        rodape TEXT,
        tema VARCHAR(5) NOT NULL DEFAULT 'light',
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Cadastro antigo carrega o nome do NOSSO produto como se fosse do cliente,
    // e um tema que nao existe mais. As duas linhas so tocam o que esta
    // literalmente errado — quem escolheu um nome proprio nao e mexido.
    await this.pool.query(
      `UPDATE webapp_white_label SET nome_plataforma = '' WHERE nome_plataforma = 'Emissor Fiscal'`);
    await this.pool.query(
      `UPDATE webapp_white_label SET tema = 'light' WHERE tema = 'auto'`);
    this.initialized = true;
  }

  async salvar(config: WhiteLabelConfig): Promise<void> {
    const cnpj = config.empresaCnpj.replace(/\D/g, '');
    await this.pool.query(
      `INSERT INTO webapp_white_label (
        empresa_cnpj, nome_plataforma, nome_exibicao,
        cor_primaria, cor_secundaria, cor_destaque, cor_background, cor_surface, cor_texto, cor_muted,
        cor_borda, border_radius, logo_base64, logo_dark_base64, favicon_base64,
        suporte_email, suporte_telefone, suporte_whatsapp, suporte_site,
        termos_url, privacidade_url, dominio_producao, mensagem_login, titulo_navegador, rodape, tema
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
      ON CONFLICT (empresa_cnpj) DO UPDATE SET
        nome_plataforma=EXCLUDED.nome_plataforma, nome_exibicao=EXCLUDED.nome_exibicao,
        cor_primaria=EXCLUDED.cor_primaria, cor_secundaria=EXCLUDED.cor_secundaria,
        cor_destaque=EXCLUDED.cor_destaque, cor_background=EXCLUDED.cor_background,
        cor_surface=EXCLUDED.cor_surface, cor_texto=EXCLUDED.cor_texto, cor_muted=EXCLUDED.cor_muted,
        cor_borda=EXCLUDED.cor_borda, border_radius=EXCLUDED.border_radius,
        logo_base64=EXCLUDED.logo_base64, logo_dark_base64=EXCLUDED.logo_dark_base64,
        favicon_base64=EXCLUDED.favicon_base64,
        suporte_email=EXCLUDED.suporte_email, suporte_telefone=EXCLUDED.suporte_telefone,
        suporte_whatsapp=EXCLUDED.suporte_whatsapp, suporte_site=EXCLUDED.suporte_site,
        termos_url=EXCLUDED.termos_url, privacidade_url=EXCLUDED.privacidade_url,
        dominio_producao=EXCLUDED.dominio_producao, mensagem_login=EXCLUDED.mensagem_login,
        titulo_navegador=EXCLUDED.titulo_navegador, rodape=EXCLUDED.rodape, tema=EXCLUDED.tema,
        atualizado_em=NOW()`,
      [
        cnpj, config.nomePlataforma, config.nomeExibicao || null,
        config.corPrimaria, config.corSecundaria, config.corDestaque,
        config.corBackground, config.corSurface, config.corTexto, config.corMuted,
        config.corBorda || null, config.borderRadius || null,
        config.logoBase64 || null, config.logoDarkBase64 || null, config.faviconBase64 || null,
        config.suporteEmail || null, config.suporteTelefone || null,
        config.suporteWhatsapp || null, config.suporteSite || null,
        config.termosUrl || null, config.privacidadeUrl || null,
        config.dominioProducao || null, config.mensagemLogin || null,
        config.tituloNavegador || null, config.rodape || null, config.tema || 'light',
      ],
    );
  }

  async obter(empresaCnpj: string): Promise<WhiteLabelConfig | null> {
    const r = await this.pool.query(
      `SELECT * FROM webapp_white_label WHERE empresa_cnpj = $1`,
      [empresaCnpj.replace(/\D/g, '')],
    );
    if (!r.rows.length) return null;
    return this.mapRow(r.rows[0]);
  }

  async obterOuPadrao(empresaCnpj: string): Promise<WhiteLabelConfig> {
    const existing = await this.obter(empresaCnpj);
    if (existing) return existing;
    return { empresaCnpj: empresaCnpj.replace(/\D/g, ''), ...DEFAULT_CONFIG };
  }

  gerarDesignTokens(config: WhiteLabelConfig): Record<string, string> {
    return {
      '--brand-primary': config.corPrimaria,
      '--brand-secondary': config.corSecundaria,
      '--brand-accent': config.corDestaque,
      '--brand-background': config.corBackground,
      '--brand-surface': config.corSurface,
      '--brand-text': config.corTexto,
      '--brand-muted': config.corMuted,
      '--brand-border': config.corBorda || '#e5e7eb',
      '--brand-radius': config.borderRadius || '8px',
    };
  }

  private mapRow(row: any): WhiteLabelConfig {
    return {
      empresaCnpj: row.empresa_cnpj,
      nomePlataforma: row.nome_plataforma,
      nomeExibicao: row.nome_exibicao,
      corPrimaria: row.cor_primaria,
      corSecundaria: row.cor_secundaria,
      corDestaque: row.cor_destaque,
      corBackground: row.cor_background,
      corSurface: row.cor_surface,
      corTexto: row.cor_texto,
      corMuted: row.cor_muted,
      corBorda: row.cor_borda,
      borderRadius: row.border_radius,
      logoBase64: row.logo_base64,
      logoDarkBase64: row.logo_dark_base64,
      faviconBase64: row.favicon_base64,
      suporteEmail: row.suporte_email,
      suporteTelefone: row.suporte_telefone,
      suporteWhatsapp: row.suporte_whatsapp,
      suporteSite: row.suporte_site,
      termosUrl: row.termos_url,
      privacidadeUrl: row.privacidade_url,
      dominioProducao: row.dominio_producao,
      mensagemLogin: row.mensagem_login,
      tituloNavegador: row.titulo_navegador,
      rodape: row.rodape,
      tema: row.tema,
      atualizadoEm: row.atualizado_em,
    };
  }
}
