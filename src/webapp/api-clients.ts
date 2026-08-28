import { Pool } from 'pg';

export type ClientStatus = 'draft' | 'sandbox' | 'active' | 'past_due' | 'suspended' | 'cancelled';

/**
 * As duas modalidades de venda, que nao sao a mesma coisa que a marca.
 *
 * `api`        — o cliente ja tem sistema e so quer credencial para integrar.
 * `plataforma` — o cliente recebe um site pronto, publicado por nos.
 *
 * A diferenca e COMERCIAL e muda o trabalho: quem entra por API nunca vai ter
 * repositorio, publicacao nem senha de painel; quem entra por plataforma
 * precisa dos tres. Misturar os dois numa lista so faz cada pergunta ("quais
 * plataformas estao desatualizadas?", "quais chaves andam paradas?") varrer
 * clientes que nao tem como responde-la.
 */
export type ModalidadeCliente = 'api' | 'plataforma';

export interface ApiClient {
  empresaCnpj: string;
  razaoSocial: string;
  fantasia?: string;
  codigoInterno?: string;
  status: ClientStatus;
  plano: string;
  responsavel?: string;
  emailTecnico?: string;
  observacoes?: string;
  /**
   * O que o cliente comprou. Ver `ModalidadeCliente`.
   *
   * Nasceu porque `whiteLabelAtiva` estava fazendo este papel, e nao e ele.
   * "Tem marca propria" e uma pergunta VISUAL; "recebe plataforma" e uma
   * pergunta comercial. Elas coincidiam so porque o mesmo botao ligava as
   * duas — e divergiam em silencio em dois casos reais: o cliente de
   * plataforma que prefere sair sob a NOSSA marca, e o cliente de API que
   * pede a logo dele no DANFE. Este segundo era pior: salvar a marca dele
   * chamava `whiteLabelAtiva: true` e o reclassificava sozinho.
   */
  modalidade: ModalidadeCliente;
  whiteLabelAtiva: boolean;
  temCertificado: boolean;
  certificadoVencimento?: string;
  templateId?: string;
  templateVersion?: string;
  plataformaUrl?: string;
  lovableProjectUrl?: string;
  repositoryUrl?: string;
  /** Ultimo commit que o painel publicou no repositorio do cliente. */
  ultimaPublicacaoCommit?: string;
  ultimaPublicacaoBranch?: string;
  ultimaPublicacaoEm?: string;
  ultimoUsoApi?: string;
  criadoEm?: string;
  atualizadoEm?: string;
}

/** Dados fiscais do emitente — o que o motor exige para montar a nota. */
export interface ApiClientFiscal {
  ie?: string;
  im?: string;
  crt?: string;
  uf?: string;
  ambiente?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  codMunicipio?: string;
  nomeMunicipio?: string;
  cep?: string;
  fone?: string;
}

export interface ApiClientLimits {
  empresaCnpj: string;
  requestsPerMinute: number;
  requestsPerDay: number;
  emissionsPerMonth: number;
}

export class ApiClientStore {
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
      CREATE TABLE IF NOT EXISTS webapp_api_clients (
        empresa_cnpj VARCHAR(14) PRIMARY KEY,
        razao_social TEXT NOT NULL DEFAULT '',
        fantasia TEXT,
        codigo_interno TEXT UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        plano VARCHAR(30) NOT NULL DEFAULT 'free',
        responsavel TEXT,
        email_tecnico TEXT,
        observacoes TEXT,
        modalidade VARCHAR(12) NOT NULL DEFAULT 'api',
        white_label_ativa BOOLEAN NOT NULL DEFAULT FALSE,
        template_id TEXT,
        template_version TEXT,
        plataforma_url TEXT,
        lovable_project_url TEXT,
        repository_url TEXT,
        ultimo_uso_api TIMESTAMPTZ,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // A coluna nasce depois da tabela, entao as instalacoes que ja existem
    // precisam ganha-la aqui — nenhuma delas tem psql a mao.
    await this.pool.query(
      `ALTER TABLE webapp_api_clients ADD COLUMN IF NOT EXISTS modalidade VARCHAR(12) NOT NULL DEFAULT 'api'`,
    ).catch(() => {});
    // Preenchimento dos que ja existem, uma vez so (`= 'api'` no fim garante
    // que nao desfaz classificacao feita a mao depois).
    //
    // A prova de que um cliente TEM plataforma e material: repositorio, URL
    // publicada, projeto no construtor ou template gravado. Marca propria
    // entra na lista por ser o unico sinal que a versao antiga registrava —
    // mas e o mais fraco, e por isso vem por ultimo.
    await this.pool.query(`
      UPDATE webapp_api_clients SET modalidade = 'plataforma'
       WHERE modalidade = 'api'
         AND (repository_url IS NOT NULL OR plataforma_url IS NOT NULL
              OR lovable_project_url IS NOT NULL OR template_id IS NOT NULL
              OR white_label_ativa = TRUE)
    `).catch(() => {});
    await this.pool.query(`ALTER TABLE webapp_api_clients ADD COLUMN IF NOT EXISTS razao_social TEXT NOT NULL DEFAULT ''`).catch(() => {});
    await this.pool.query(`ALTER TABLE webapp_api_clients ADD COLUMN IF NOT EXISTS fantasia TEXT`).catch(() => {});
    await this.pool.query(`ALTER TABLE webapp_api_clients ADD COLUMN IF NOT EXISTS pfx_encrypted TEXT`).catch(() => {});
    await this.pool.query(`ALTER TABLE webapp_api_clients ADD COLUMN IF NOT EXISTS pfx_password_encrypted TEXT`).catch(() => {});
    await this.pool.query(`ALTER TABLE webapp_api_clients ADD COLUMN IF NOT EXISTS certificado_vencimento TIMESTAMPTZ`).catch(() => {});
    // Guardar QUAL versao cada cliente recebeu. Sem isto, "esse cliente ja tem a
    // correcao de tal dia?" so se responde abrindo o repositorio dele.
    for (const col of [
      'ultima_publicacao_commit TEXT', 'ultima_publicacao_branch TEXT',
      'ultima_publicacao_em TIMESTAMPTZ',
    ]) {
      await this.pool.query(`ALTER TABLE webapp_api_clients ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    }
    // Dados fiscais do emitente. Sem eles a chave de API existe mas nao emite:
    // o motor precisa de IE, regime e endereco com codigo IBGE para montar a nota.
    for (const col of [
      'ie TEXT', 'im TEXT', 'crt VARCHAR(2)', 'uf VARCHAR(2)', 'ambiente VARCHAR(1)',
      'logradouro TEXT', 'numero TEXT', 'complemento TEXT', 'bairro TEXT',
      'cod_municipio TEXT', 'nome_municipio TEXT', 'cep TEXT', 'fone TEXT',
    ]) {
      await this.pool.query(`ALTER TABLE webapp_api_clients ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    }
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_api_client_limits (
        empresa_cnpj VARCHAR(14) PRIMARY KEY,
        requests_per_minute INTEGER NOT NULL DEFAULT 30,
        requests_per_day INTEGER NOT NULL DEFAULT 2000,
        emissions_per_month INTEGER NOT NULL DEFAULT 100
      )
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_api_clients_status ON webapp_api_clients (status)`,
    );
    this.initialized = true;
  }

  async criar(data: {
    empresaCnpj: string;
    razaoSocial: string;
    fantasia?: string;
    codigoInterno?: string;
    plano?: string;
    responsavel?: string;
    emailTecnico?: string;
    observacoes?: string;
    modalidade?: ModalidadeCliente;
  }): Promise<ApiClient> {
    const cnpj = data.empresaCnpj.replace(/\D/g, '');
    const codigo = data.codigoInterno || `CLI_${cnpj.slice(0, 8)}`;
    const r = await this.pool.query(
      `INSERT INTO webapp_api_clients
        (empresa_cnpj, razao_social, fantasia, codigo_interno, plano, responsavel, email_tecnico, observacoes, modalidade)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (empresa_cnpj) DO UPDATE SET
        razao_social = COALESCE(EXCLUDED.razao_social, webapp_api_clients.razao_social),
        fantasia = COALESCE(EXCLUDED.fantasia, webapp_api_clients.fantasia),
        codigo_interno = COALESCE(EXCLUDED.codigo_interno, webapp_api_clients.codigo_interno),
        plano = COALESCE(EXCLUDED.plano, webapp_api_clients.plano),
        responsavel = COALESCE(EXCLUDED.responsavel, webapp_api_clients.responsavel),
        email_tecnico = COALESCE(EXCLUDED.email_tecnico, webapp_api_clients.email_tecnico),
        observacoes = COALESCE(EXCLUDED.observacoes, webapp_api_clients.observacoes),
        modalidade = EXCLUDED.modalidade,
        atualizado_em = NOW()
       RETURNING *`,
      [cnpj, data.razaoSocial, data.fantasia || null, codigo, data.plano || 'free',
       data.responsavel || null, data.emailTecnico || null, data.observacoes || null,
       // `api` e o padrao seguro: cria credencial e mais nada. Prometer
       // plataforma a quem nao comprou custa trabalho; deixar de prometer a
       // quem comprou aparece na hora, porque o cliente cobra.
       data.modalidade === 'plataforma' ? 'plataforma' : 'api'],
    );
    await this.pool.query(
      `INSERT INTO webapp_api_client_limits (empresa_cnpj) VALUES ($1) ON CONFLICT DO NOTHING`,
      [cnpj],
    );
    return this.mapRow(r.rows[0]);
  }

  async listar(filtros?: {
    status?: ClientStatus;
    plano?: string;
    modalidade?: ModalidadeCliente;
    whiteLabel?: boolean;
    busca?: string;
    limite?: number;
    offset?: number;
  }): Promise<{ clients: ApiClient[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filtros?.status) {
      conditions.push(`c.status = $${idx++}`);
      params.push(filtros.status);
    }
    if (filtros?.plano) {
      conditions.push(`c.plano = $${idx++}`);
      params.push(filtros.plano);
    }
    if (filtros?.modalidade) {
      conditions.push(`c.modalidade = $${idx++}`);
      params.push(filtros.modalidade);
    }
    if (filtros?.whiteLabel !== undefined) {
      conditions.push(`c.white_label_ativa = $${idx++}`);
      params.push(filtros.whiteLabel);
    }
    if (filtros?.busca) {
      conditions.push(`(c.razao_social ILIKE $${idx} OR c.fantasia ILIKE $${idx} OR c.empresa_cnpj LIKE $${idx})`);
      params.push(`%${filtros.busca}%`);
      idx++;
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const limite = Math.min(filtros?.limite || 50, 200);
    const offset = filtros?.offset || 0;

    const countR = await this.pool.query(
      `SELECT COUNT(*) FROM webapp_api_clients c ${where}`,
      params,
    );
    const total = parseInt(countR.rows[0].count, 10);

    const r = await this.pool.query(
      `SELECT c.*
       FROM webapp_api_clients c
       ${where}
       ORDER BY c.criado_em DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limite, offset],
    );

    return {
      total,
      clients: r.rows.map(this.mapRow),
    };
  }

  async obter(empresaCnpj: string): Promise<ApiClient | null> {
    const r = await this.pool.query(
      `SELECT * FROM webapp_api_clients WHERE empresa_cnpj = $1`,
      [empresaCnpj.replace(/\D/g, '')],
    );
    return r.rows.length ? this.mapRow(r.rows[0]) : null;
  }

  async atualizarStatus(empresaCnpj: string, status: ClientStatus): Promise<void> {
    await this.pool.query(
      `UPDATE webapp_api_clients SET status = $2, atualizado_em = NOW() WHERE empresa_cnpj = $1`,
      [empresaCnpj.replace(/\D/g, ''), status],
    );
  }

  async atualizar(empresaCnpj: string, data: Partial<ApiClient>): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    const fields: [keyof ApiClient, string][] = [
      ['razaoSocial', 'razao_social'], ['fantasia', 'fantasia'],
      ['plano', 'plano'], ['responsavel', 'responsavel'], ['emailTecnico', 'email_tecnico'],
      ['observacoes', 'observacoes'], ['modalidade', 'modalidade'],
    ['whiteLabelAtiva', 'white_label_ativa'],
      ['templateId', 'template_id'], ['templateVersion', 'template_version'],
      ['plataformaUrl', 'plataforma_url'], ['lovableProjectUrl', 'lovable_project_url'],
      ['repositoryUrl', 'repository_url'], ['codigoInterno', 'codigo_interno'],
      ['ultimaPublicacaoCommit', 'ultima_publicacao_commit'],
      ['ultimaPublicacaoBranch', 'ultima_publicacao_branch'],
      ['ultimaPublicacaoEm', 'ultima_publicacao_em'],
    ];
    for (const [key, col] of fields) {
      if (data[key] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        params.push(data[key]);
      }
    }
    if (!sets.length) return;
    sets.push('atualizado_em = NOW()');
    params.push(empresaCnpj.replace(/\D/g, ''));
    await this.pool.query(
      `UPDATE webapp_api_clients SET ${sets.join(', ')} WHERE empresa_cnpj = $${idx}`,
      params,
    );
  }

  async obterLimites(empresaCnpj: string): Promise<ApiClientLimits> {
    const cnpj = empresaCnpj.replace(/\D/g, '');
    const r = await this.pool.query(
      `SELECT * FROM webapp_api_client_limits WHERE empresa_cnpj = $1`,
      [cnpj],
    );
    if (!r.rows.length) {
      return { empresaCnpj: cnpj, requestsPerMinute: 30, requestsPerDay: 2000, emissionsPerMonth: 100 };
    }
    const row = r.rows[0];
    return {
      empresaCnpj: row.empresa_cnpj,
      requestsPerMinute: row.requests_per_minute,
      requestsPerDay: row.requests_per_day,
      emissionsPerMonth: row.emissions_per_month,
    };
  }

  async atualizarLimites(empresaCnpj: string, limits: Partial<ApiClientLimits>): Promise<void> {
    const cnpj = empresaCnpj.replace(/\D/g, '');
    await this.pool.query(
      `INSERT INTO webapp_api_client_limits (empresa_cnpj, requests_per_minute, requests_per_day, emissions_per_month)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (empresa_cnpj) DO UPDATE SET
        requests_per_minute = COALESCE($2, webapp_api_client_limits.requests_per_minute),
        requests_per_day = COALESCE($3, webapp_api_client_limits.requests_per_day),
        emissions_per_month = COALESCE($4, webapp_api_client_limits.emissions_per_month)`,
      [cnpj, limits.requestsPerMinute || 30, limits.requestsPerDay || 2000, limits.emissionsPerMonth || 100],
    );
  }

  async salvarCertificado(empresaCnpj: string, pfxEncrypted: string, pfxPasswordEncrypted: string, vencimento?: Date): Promise<void> {
    const cnpj = empresaCnpj.replace(/\D/g, '');
    await this.pool.query(
      `UPDATE webapp_api_clients SET pfx_encrypted = $2, pfx_password_encrypted = $3, certificado_vencimento = $4, atualizado_em = NOW() WHERE empresa_cnpj = $1`,
      [cnpj, pfxEncrypted, pfxPasswordEncrypted, vencimento || null],
    );
  }

  async obterCertificado(empresaCnpj: string): Promise<{ pfxEncrypted: string; pfxPasswordEncrypted: string; vencimento?: string } | null> {
    const cnpj = empresaCnpj.replace(/\D/g, '');
    const r = await this.pool.query(
      `SELECT pfx_encrypted, pfx_password_encrypted, certificado_vencimento FROM webapp_api_clients WHERE empresa_cnpj = $1`,
      [cnpj],
    );
    if (!r.rows.length || !r.rows[0].pfx_encrypted) return null;
    return {
      pfxEncrypted: r.rows[0].pfx_encrypted,
      pfxPasswordEncrypted: r.rows[0].pfx_password_encrypted,
      vencimento: r.rows[0].certificado_vencimento,
    };
  }

  /**
   * Campos do emitente sem os quais a nota não se monta. Usado tanto na guarda
   * do contexto quanto no health, para a tela não dizer "pronto" e a emissão
   * falhar depois.
   */
  static readonly CAMPOS_FISCAIS = ['ie', 'uf', 'cod_municipio', 'logradouro', 'bairro', 'nome_municipio', 'cep'] as const;

  static fiscalCompleto(row: Record<string, unknown>): boolean {
    return ApiClientStore.CAMPOS_FISCAIS.every((c) => String(row[c] ?? '').trim().length >= 2);
  }

  /** Lista legível do que falta — alimenta a mensagem de pendência na tela. */
  static fiscalFaltando(f: ApiClientFiscal | null): string[] {
    const rotulos: Record<string, string> = {
      ie: 'Inscricao Estadual', uf: 'UF', codMunicipio: 'codigo IBGE do municipio',
      logradouro: 'logradouro', bairro: 'bairro', nomeMunicipio: 'municipio', cep: 'CEP',
    };
    if (!f) return Object.values(rotulos);
    return Object.keys(rotulos)
      .filter((k) => String((f as Record<string, unknown>)[k] ?? '').trim().length < 2)
      .map((k) => rotulos[k]!);
  }

  async obterFiscal(empresaCnpj: string): Promise<ApiClientFiscal | null> {
    const r = await this.pool.query(
      `SELECT ie, im, crt, uf, ambiente, logradouro, numero, complemento, bairro,
              cod_municipio, nome_municipio, cep, fone
         FROM webapp_api_clients WHERE empresa_cnpj = $1`,
      [empresaCnpj.replace(/\D/g, '')],
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return {
      ie: row.ie ?? undefined, im: row.im ?? undefined, crt: row.crt ?? undefined,
      uf: row.uf ?? undefined, ambiente: row.ambiente ?? undefined,
      logradouro: row.logradouro ?? undefined, numero: row.numero ?? undefined,
      complemento: row.complemento ?? undefined, bairro: row.bairro ?? undefined,
      codMunicipio: row.cod_municipio ?? undefined, nomeMunicipio: row.nome_municipio ?? undefined,
      cep: row.cep ?? undefined, fone: row.fone ?? undefined,
    };
  }

  async salvarFiscal(empresaCnpj: string, f: ApiClientFiscal): Promise<void> {
    const cnpj = empresaCnpj.replace(/\D/g, '');
    const campos: [keyof ApiClientFiscal, string][] = [
      ['ie', 'ie'], ['im', 'im'], ['crt', 'crt'], ['uf', 'uf'], ['ambiente', 'ambiente'],
      ['logradouro', 'logradouro'], ['numero', 'numero'], ['complemento', 'complemento'],
      ['bairro', 'bairro'], ['codMunicipio', 'cod_municipio'], ['nomeMunicipio', 'nome_municipio'],
      ['cep', 'cep'], ['fone', 'fone'],
    ];
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const [key, col] of campos) {
      if (f[key] === undefined) continue;
      let valor: unknown = f[key];
      // A IE vai crua para o XML: normalizada na escrita, como em empresas.ts.
      // "ISENTO" é palavra reservada da SEFAZ e não pode virar string vazia.
      if (key === 'ie') {
        const bruto = String(valor ?? '').trim();
        valor = /^isent[oa]$/i.test(bruto) ? 'ISENTO' : bruto.replace(/\D/g, '');
      } else if (key === 'cep') {
        valor = String(valor ?? '').replace(/\D/g, '');
      } else if (key === 'uf') {
        valor = String(valor ?? '').trim().toUpperCase();
      }
      sets.push(`${col} = $${idx++}`);
      params.push(valor);
    }
    if (!sets.length) return;
    sets.push('atualizado_em = NOW()');
    params.push(cnpj);
    await this.pool.query(
      `UPDATE webapp_api_clients SET ${sets.join(', ')} WHERE empresa_cnpj = $${idx}`,
      params,
    );
  }

  /**
   * Monta o contexto de emissão a partir do cadastro do cliente de API.
   * Devolve null se faltar o essencial — melhor recusar do que emitir nota
   * com dado inventado.
   */
  async obterContextoFiscal(empresaCnpj: string): Promise<{
    cnpj: string; razaoSocial: string; fantasia?: string; ie: string; im?: string;
    crt: string; uf: string; ambiente: string;
    endereco: {
      logradouro: string; numero: string; complemento?: string; bairro: string;
      codigoMunicipio: string; nomeMunicipio: string; cep: string; fone?: string;
    };
    pfxBuffer: Buffer; pfxPassword: string;
  } | null> {
    const cnpj = empresaCnpj.replace(/\D/g, '');
    const r = await this.pool.query(`SELECT * FROM webapp_api_clients WHERE empresa_cnpj = $1`, [cnpj]);
    if (!r.rows.length) return null;
    const row = r.rows[0];
    if (row.status !== 'active' && row.status !== 'sandbox') return null;
    if (!row.pfx_encrypted || !row.pfx_password_encrypted) return null;
    // Endereço incompleto sairia como xLgr/xBairro vazios e a SEFAZ rejeitaria
    // com erro obscuro. Recusar aqui devolve um erro que se entende.
    if (!ApiClientStore.fiscalCompleto(row)) return null;

    const { decryptSecret } = require('./crypto');
    return {
      cnpj: row.empresa_cnpj,
      razaoSocial: row.razao_social,
      fantasia: row.fantasia ?? undefined,
      ie: row.ie,
      im: row.im ?? undefined,
      crt: row.crt || '3',
      uf: row.uf,
      // Cliente em sandbox nunca emite em produção, mesmo que o cadastro diga o contrário.
      ambiente: row.status === 'sandbox' ? '2' : (row.ambiente || '2'),
      endereco: {
        logradouro: row.logradouro || '',
        numero: row.numero || 'S/N',
        complemento: row.complemento ?? undefined,
        bairro: row.bairro || '',
        codigoMunicipio: row.cod_municipio,
        nomeMunicipio: row.nome_municipio || '',
        cep: (row.cep || '').replace(/\D/g, ''),
        fone: row.fone ?? undefined,
      },
      pfxBuffer: decryptSecret(row.pfx_encrypted),
      pfxPassword: decryptSecret(row.pfx_password_encrypted).toString('utf-8'),
    };
  }

  async excluir(empresaCnpj: string): Promise<boolean> {
    const cnpj = empresaCnpj.replace(/\D/g, '');
    await this.pool.query(`DELETE FROM webapp_api_client_limits WHERE empresa_cnpj = $1`, [cnpj]).catch(() => {});
    await this.pool.query(`DELETE FROM webapp_client_services WHERE empresa_cnpj = $1`, [cnpj]).catch(() => {});
    await this.pool.query(`DELETE FROM webapp_webhook_endpoints WHERE empresa_cnpj = $1`, [cnpj]).catch(() => {});
    await this.pool.query(`DELETE FROM webapp_white_label WHERE empresa_cnpj = $1`, [cnpj]).catch(() => {});
    const r = await this.pool.query(`DELETE FROM webapp_api_clients WHERE empresa_cnpj = $1`, [cnpj]);
    return (r.rowCount ?? 0) > 0;
  }

  async registrarUsoApi(empresaCnpj: string): Promise<void> {
    this.pool.query(
      `UPDATE webapp_api_clients SET ultimo_uso_api = NOW() WHERE empresa_cnpj = $1`,
      [empresaCnpj.replace(/\D/g, '')],
    ).catch(() => {});
  }

  async dashboard(): Promise<{
    ativos: number; sandbox: number; suspensos: number; total: number;
    porApi: number; comPlataforma: number;
    whiteLabelAtivas: number; emissoesMes: number;
    /**
     * O mesmo recorte, dentro de cada modalidade.
     *
     * O total global nao serve dentro de uma aba de modalidade: dizer "2
     * ativos" na aba "Por API" quando um deles e de plataforma e uma conta
     * errada exibida com confianca.
     */
    porModalidade: Record<'api' | 'plataforma', {
      total: number; ativos: number; sandbox: number;
      suspensos: number; marcaPropria: number;
    }>;
  }> {
    const r = await this.pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as ativos,
        COUNT(*) FILTER (WHERE status = 'sandbox') as sandbox,
        COUNT(*) FILTER (WHERE status = 'suspended') as suspensos,
        COUNT(*) FILTER (WHERE modalidade = 'api') as por_api,
        COUNT(*) FILTER (WHERE modalidade = 'plataforma') as com_plataforma,
        COUNT(*) FILTER (WHERE white_label_ativa = TRUE) as white_label
      FROM webapp_api_clients
    `);
    const porMod = await this.pool.query(`
      SELECT
        modalidade,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as ativos,
        COUNT(*) FILTER (WHERE status = 'sandbox') as sandbox,
        COUNT(*) FILTER (WHERE status IN ('suspended', 'past_due')) as suspensos,
        COUNT(*) FILTER (WHERE white_label_ativa = TRUE) as marca_propria
      FROM webapp_api_clients
      GROUP BY modalidade
    `);
    const vazio = { total: 0, ativos: 0, sandbox: 0, suspensos: 0, marcaPropria: 0 };
    const porModalidade = { api: { ...vazio }, plataforma: { ...vazio } };
    for (const linha of porMod.rows) {
      const chave = linha.modalidade === 'plataforma' ? 'plataforma' : 'api';
      porModalidade[chave] = {
        total: +linha.total, ativos: +linha.ativos, sandbox: +linha.sandbox,
        suspensos: +linha.suspensos, marcaPropria: +linha.marca_propria,
      };
    }

    const row = r.rows[0];
    return {
      porModalidade,
      total: +row.total,
      ativos: +row.ativos,
      sandbox: +row.sandbox,
      suspensos: +row.suspensos,
      porApi: +row.por_api,
      comPlataforma: +row.com_plataforma,
      whiteLabelAtivas: +row.white_label,
      emissoesMes: 0,
    };
  }

  private mapRow(row: any): ApiClient {
    return {
      empresaCnpj: row.empresa_cnpj,
      razaoSocial: row.razao_social || '',
      fantasia: row.fantasia,
      codigoInterno: row.codigo_interno,
      status: row.status,
      plano: row.plano,
      responsavel: row.responsavel,
      emailTecnico: row.email_tecnico,
      observacoes: row.observacoes,
      // Instalacao antiga, antes da coluna existir: sem valor, `api` e o
      // padrao seguro — nao inventa plataforma para quem nao tem.
      modalidade: row.modalidade === 'plataforma' ? 'plataforma' : 'api',
      whiteLabelAtiva: row.white_label_ativa,
      temCertificado: !!row.pfx_encrypted,
      certificadoVencimento: row.certificado_vencimento,
      templateId: row.template_id,
      templateVersion: row.template_version,
      plataformaUrl: row.plataforma_url,
      lovableProjectUrl: row.lovable_project_url,
      repositoryUrl: row.repository_url,
      ultimaPublicacaoCommit: row.ultima_publicacao_commit,
      ultimaPublicacaoBranch: row.ultima_publicacao_branch,
      ultimaPublicacaoEm: row.ultima_publicacao_em,
      ultimoUsoApi: row.ultimo_uso_api,
      criadoEm: row.criado_em,
      atualizadoEm: row.atualizado_em,
    };
  }
}
