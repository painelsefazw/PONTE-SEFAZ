/**
 * Catálogo de produtos por empresa (multi-tenant), guardado no banco do emissor.
 * Cada produto guarda a classificação fiscal pronta; na emissão o operador só escolhe
 * o produto e a nota é preenchida. A sugestão fiscal vem do FiscalBrain (cadastro).
 */
import { Pool } from 'pg';

export interface Produto {
  id?: number;
  empresaCnpj: string;
  codigo: string;
  descricao: string;
  ean?: string;
  ncm: string;
  cest?: string;
  cfop: string;
  unidade: string;
  valorUnitario?: string;
  origem: string;
  cstCsosn: string;
  aliqIcms?: string;
  redBcIcms?: string;
  cstIpi: string;
  aliqIpi?: string;
  cstPis: string;
  cstCofins: string;
  mva?: string;
  aliqIcmsSt?: string;
  cbenef?: string;
  /**
   * Classificação de IBS/CBS do produto (Reforma Tributária).
   * Vazio = tributação integral (CST 000 / cClassTrib 000001), o caso da
   * maioria. Preencher só em produto com tratamento próprio — isento, imune,
   * monofásico, cesta básica.
   */
  ibscbsCst?: string;
  ibscbsCclasstrib?: string;
  /**
   * Percentual de redução de alíquota, só para CST 200. `100` = alíquota zero.
   * Dispensável quando o cClassTrib já consta da tabela embutida no motor.
   */
  ibscbsPRedAliq?: string;
}

function rowToProduto(r: any): Produto {
  return {
    id: r.id,
    empresaCnpj: r.empresa_cnpj,
    codigo: r.codigo,
    descricao: r.descricao,
    ean: r.ean ?? undefined,
    ncm: r.ncm,
    cest: r.cest ?? undefined,
    cfop: r.cfop,
    unidade: r.unidade,
    valorUnitario: r.valor_unitario != null ? String(r.valor_unitario) : undefined,
    origem: r.origem,
    cstCsosn: r.cst_csosn,
    aliqIcms: r.aliq_icms ?? undefined,
    redBcIcms: r.red_bc_icms ?? undefined,
    cstIpi: r.cst_ipi,
    aliqIpi: r.aliq_ipi ?? undefined,
    cstPis: r.cst_pis,
    cstCofins: r.cst_cofins,
    mva: r.mva ?? undefined,
    aliqIcmsSt: r.aliq_icms_st ?? undefined,
    cbenef: r.cbenef ?? undefined,
    ibscbsCst: r.ibscbs_cst ?? undefined,
    ibscbsCclasstrib: r.ibscbs_cclasstrib ?? undefined,
    ibscbsPRedAliq: r.ibscbs_pred_aliq ?? undefined,
  };
}

export interface RegraFiscal {
  id?: number;
  ncm: string;
  uf: string;
  descricao: string;
  cstIcmsNormal?: string;
  csosnSimples?: string;
  cfopSaida?: string;
  aliqIcms?: string;
  redBcIcms?: string;
  cstIpi?: string;
  aliqIpi?: string;
  cest?: string;
  mva?: string;
  aliqIcmsSt?: string;
  cbenef?: string;
  /**
   * Fundo de Combate a Pobreza da UF. Entra no DIFAL como pFCPUFDest quando a
   * regra e da UF de DESTINO — por isso vale a pena cadastrar regra do estado
   * para onde se vende, e nao so do proprio.
   */
  fcp?: string;
  baseLegal?: string;
  /**
   * Dono da regra: vazio é regra geral do sistema, preenchido é da empresa.
   * A tela usa isto para marcar o que pode ser editado — sem o campo, toda
   * regra parece geral e o usuário não sabe qual é a dele.
   */
  empresaCnpj?: string;
}

export class ProdutoStore {
  private pool: Pool;
  private initialized = false;

  constructor(poolOrUrl: Pool | string) {
    if (typeof poolOrUrl === 'string') {
      const isLocal = /localhost|127\.0\.0\.1/.test(poolOrUrl);
      this.pool = new Pool({ connectionString: poolOrUrl, ssl: isLocal ? undefined : { rejectUnauthorized: false }, max: 3 });
    } else {
      this.pool = poolOrUrl;
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_produtos (
        id SERIAL PRIMARY KEY,
        empresa_cnpj VARCHAR(14) NOT NULL,
        codigo TEXT NOT NULL,
        descricao TEXT NOT NULL,
        ean TEXT,
        ncm TEXT NOT NULL,
        cest TEXT,
        cfop TEXT NOT NULL DEFAULT '5102',
        unidade TEXT NOT NULL DEFAULT 'UN',
        valor_unitario NUMERIC(15,2),
        origem TEXT NOT NULL DEFAULT '0',
        cst_csosn TEXT NOT NULL,
        aliq_icms TEXT,
        red_bc_icms TEXT,
        cst_ipi TEXT NOT NULL DEFAULT '53',
        aliq_ipi TEXT,
        cst_pis TEXT NOT NULL DEFAULT '99',
        cst_cofins TEXT NOT NULL DEFAULT '99',
        mva TEXT,
        aliq_icms_st TEXT,
        cbenef TEXT,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (empresa_cnpj, codigo)
      );
    `);
    // Classificação de IBS/CBS por produto (Reforma Tributária). Nulo = usa o
    // padrão de tributação integral aplicado pelo motor.
    await this.pool.query(`ALTER TABLE webapp_produtos ADD COLUMN IF NOT EXISTS ibscbs_cst TEXT`);
    await this.pool.query(`ALTER TABLE webapp_produtos ADD COLUMN IF NOT EXISTS ibscbs_cclasstrib TEXT`);
    // Percentual de redução do CST 200. O motor traz embutidos só os cClassTrib
    // já conferidos na tabela oficial; para os demais o percentual tem de vir de
    // algum lugar, e o cadastro do produto é onde a decisão da contabilidade
    // mora. Nulo = usa a tabela embutida (ou recusa, se o código não estiver lá).
    await this.pool.query(`ALTER TABLE webapp_produtos ADD COLUMN IF NOT EXISTS ibscbs_pred_aliq TEXT`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_regras_fiscais (
        id SERIAL PRIMARY KEY,
        ncm VARCHAR(8) NOT NULL,
        uf VARCHAR(2) NOT NULL DEFAULT 'SP',
        descricao TEXT NOT NULL DEFAULT '',
        cst_icms_normal TEXT,
        csosn_simples TEXT,
        cfop_saida TEXT DEFAULT '5102',
        aliq_icms TEXT,
        red_bc_icms TEXT,
        cst_ipi TEXT DEFAULT '53',
        aliq_ipi TEXT,
        cest TEXT,
        mva TEXT,
        aliq_icms_st TEXT,
        cbenef TEXT,
        base_legal TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (ncm, uf)
      );
    `);

    // A tabela nasceu global: uma regra por (ncm, uf) valia para todo mundo.
    // Com clientes de API escrevendo as próprias regras, cada empresa precisa
    // do seu espaço — senão um cliente muda o imposto do outro.
    //
    // empresa_cnpj NULL = regra global (a que o contador cadastra pelo painel).
    // Preenchido = regra daquela empresa, que tem prioridade sobre a global.
    await this.pool.query(
      `ALTER TABLE webapp_regras_fiscais ADD COLUMN IF NOT EXISTS empresa_cnpj VARCHAR(14)`,
    );
    await this.pool.query(
      `ALTER TABLE webapp_regras_fiscais ADD COLUMN IF NOT EXISTS fcp TEXT`,
    ).catch(() => {});

    // A UNIQUE(ncm, uf) original impediria uma empresa de ter regra própria
    // para um NCM que já tem regra global. Trocada por dois índices parciais:
    // um para a global, outro por empresa. (NULL não colide com NULL em índice
    // comum, por isso o WHERE.)
    await this.pool.query(
      `ALTER TABLE webapp_regras_fiscais DROP CONSTRAINT IF EXISTS webapp_regras_fiscais_ncm_uf_key`,
    ).catch(() => {});
    await this.pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_regra_global
         ON webapp_regras_fiscais (ncm, uf) WHERE empresa_cnpj IS NULL`,
    ).catch(() => {});
    await this.pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_regra_empresa
         ON webapp_regras_fiscais (ncm, uf, empresa_cnpj) WHERE empresa_cnpj IS NOT NULL`,
    ).catch(() => {});

    this.initialized = true;
  }

  async listar(empresaCnpj: string): Promise<Produto[]> {
    const r = await this.pool.query(
      `SELECT * FROM webapp_produtos WHERE empresa_cnpj = $1 AND ativo = TRUE ORDER BY descricao`,
      [empresaCnpj.replace(/\D/g, '')],
    );
    return r.rows.map(rowToProduto);
  }

  /** Autocomplete na emissão: por descrição, código ou NCM. */
  async buscar(empresaCnpj: string, q: string, limit = 12): Promise<Produto[]> {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const r = await this.pool.query(
      `SELECT * FROM webapp_produtos
       WHERE empresa_cnpj = $1 AND ativo = TRUE
         AND (descricao ILIKE $2 OR codigo ILIKE $2 OR ncm ILIKE $2)
       ORDER BY descricao LIMIT $3`,
      [empresaCnpj.replace(/\D/g, ''), like, limit],
    );
    return r.rows.map(rowToProduto);
  }

  /** Upsert por (empresa, codigo). */
  async salvar(p: Produto): Promise<Produto> {
    const r = await this.pool.query(
      `INSERT INTO webapp_produtos
        (empresa_cnpj, codigo, descricao, ean, ncm, cest, cfop, unidade, valor_unitario,
         origem, cst_csosn, aliq_icms, red_bc_icms, cst_ipi, aliq_ipi, cst_pis, cst_cofins, mva, aliq_icms_st, cbenef,
         ibscbs_cst, ibscbs_cclasstrib, ibscbs_pred_aliq, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,TRUE)
       ON CONFLICT (empresa_cnpj, codigo) DO UPDATE SET
         descricao=$3, ean=$4, ncm=$5, cest=$6, cfop=$7, unidade=$8, valor_unitario=$9,
         origem=$10, cst_csosn=$11, aliq_icms=$12, red_bc_icms=$13, cst_ipi=$14, aliq_ipi=$15,
         cst_pis=$16, cst_cofins=$17, mva=$18, aliq_icms_st=$19, cbenef=$20,
         ibscbs_cst=$21, ibscbs_cclasstrib=$22, ibscbs_pred_aliq=$23, ativo=TRUE
       RETURNING *`,
      [
        p.empresaCnpj.replace(/\D/g, ''), p.codigo, p.descricao, p.ean ?? null,
        p.ncm.replace(/\D/g, ''), p.cest ? p.cest.replace(/\D/g, '') : null, p.cfop || '5102', p.unidade || 'UN',
        p.valorUnitario ? Number(p.valorUnitario) : null,
        p.origem || '0', p.cstCsosn, p.aliqIcms ?? null, p.redBcIcms ?? null,
        p.cstIpi || '53', p.aliqIpi ?? null, p.cstPis || '99', p.cstCofins || '99',
        p.mva ?? null, p.aliqIcmsSt ?? null, p.cbenef ?? null,
        p.ibscbsCst || null, p.ibscbsCclasstrib || null, p.ibscbsPRedAliq || null,
      ],
    );
    return rowToProduto(r.rows[0]);
  }

  /**
   * Classificação de IBS/CBS dos códigos informados, em uma consulta só.
   * Usado na emissão para completar o que o ERP não manda — ele não tem como
   * saber a classificação de IBS/CBS, que é decisão da contabilidade.
   * Devolve apenas os produtos que têm classificação própria cadastrada.
   */
  async classificacaoIbsCbs(
    empresaCnpj: string,
    codigos: string[],
  ): Promise<Map<string, { cst: string; cClassTrib?: string; pRedAliq?: string }>> {
    const mapa = new Map<string, { cst: string; cClassTrib?: string; pRedAliq?: string }>();
    const lista = [...new Set(codigos.filter(Boolean))];
    if (!lista.length) return mapa;

    const r = await this.pool.query(
      `SELECT codigo, ibscbs_cst, ibscbs_cclasstrib, ibscbs_pred_aliq
         FROM webapp_produtos
        WHERE empresa_cnpj = $1 AND ativo = TRUE
          AND codigo = ANY($2::text[])
          AND ibscbs_cst IS NOT NULL`,
      [empresaCnpj.replace(/\D/g, ''), lista],
    );
    for (const row of r.rows) {
      // O cClassTrib não pode cair em '000001' quando falta: esse é o código da
      // tributação integral, e casado com um CST 200 monta um par que não existe
      // na tabela (a SEFAZ rejeita com 1024). Faltando, o campo vai vazio e o
      // motor reclama dizendo o que cadastrar — bem melhor que uma nota
      // silenciosamente errada.
      mapa.set(row.codigo, {
        cst: row.ibscbs_cst,
        ...(row.ibscbs_cclasstrib ? { cClassTrib: row.ibscbs_cclasstrib } : {}),
        ...(row.ibscbs_pred_aliq ? { pRedAliq: row.ibscbs_pred_aliq } : {}),
      });
    }
    return mapa;
  }

  async remover(id: number, empresaCnpj: string): Promise<void> {
    await this.pool.query(
      `UPDATE webapp_produtos SET ativo = FALSE WHERE id = $1 AND empresa_cnpj = $2`,
      [id, empresaCnpj.replace(/\D/g, '')],
    );
  }

  // ---------------------------------------------------------------------------
  // Efeito rede: busca produtos de OUTRAS empresas como sugestão
  // ---------------------------------------------------------------------------
  async buscarCompartilhado(excluirCnpj: string, q: string, limit = 8): Promise<(Produto & { origemEmpresa: string })[]> {
    if (!q || q.trim().length < 2) return [];
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const r = await this.pool.query(
      `SELECT DISTINCT ON (ncm, descricao) * FROM webapp_produtos
       WHERE empresa_cnpj != $1 AND ativo = TRUE
         AND (descricao ILIKE $2 OR ncm ILIKE $2)
       ORDER BY ncm, descricao, criado_em DESC
       LIMIT $3`,
      [excluirCnpj.replace(/\D/g, ''), like, limit],
    );
    return r.rows.map(row => ({
      ...rowToProduto(row),
      origemEmpresa: row.empresa_cnpj,
    }));
  }

  // ---------------------------------------------------------------------------
  // Regras fiscais locais (alimentadas pelo contador)
  // ---------------------------------------------------------------------------
  /**
   * Regras visíveis para quem consulta: as próprias e as globais.
   *
   * Quando a empresa tem regra para o mesmo NCM que já tem global, só a dela
   * aparece — é a que vai valer na emissão, e mostrar as duas faria o contador
   * conferir a que não é usada.
   */
  async listarRegras(uf: string, empresaCnpj?: string): Promise<RegraFiscal[]> {
    const cnpj = empresaCnpj ? empresaCnpj.replace(/\D/g, '') : null;
    const r = await this.pool.query(
      `SELECT DISTINCT ON (ncm) *
         FROM webapp_regras_fiscais
        WHERE uf = $1 AND (empresa_cnpj IS NULL OR empresa_cnpj = $2)
        ORDER BY ncm, (empresa_cnpj IS NULL)`,
      [uf.toUpperCase(), cnpj],
    );
    return r.rows.map(this.rowToRegra);
  }

  /**
   * Grava a regra. Sem `empresaCnpj` é regra global (só o administrador chega
   * aqui); com CNPJ é regra daquela empresa, que não afeta ninguém mais.
   */
  async salvarRegra(regra: Partial<RegraFiscal>, empresaCnpj?: string): Promise<RegraFiscal> {
    const ncm = (regra.ncm || '').replace(/\D/g, '');
    const uf = (regra.uf || 'SP').toUpperCase();
    const cnpj = empresaCnpj ? empresaCnpj.replace(/\D/g, '') : null;
    // O upsert precisa apontar o índice parcial certo: os dois espaços são
    // independentes, e o global não pode sobrescrever o da empresa.
    const conflito = cnpj
      ? '(ncm, uf, empresa_cnpj) WHERE empresa_cnpj IS NOT NULL'
      : '(ncm, uf) WHERE empresa_cnpj IS NULL';
    const r = await this.pool.query(
      `INSERT INTO webapp_regras_fiscais
        (ncm, uf, empresa_cnpj, descricao, cst_icms_normal, csosn_simples, cfop_saida,
         aliq_icms, red_bc_icms, cst_ipi, aliq_ipi, cest, mva, aliq_icms_st, cbenef, base_legal, fcp)
       VALUES ($1,$2,$16,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$17)
       ON CONFLICT ${conflito} DO UPDATE SET
         descricao=$3, cst_icms_normal=$4, csosn_simples=$5, cfop_saida=$6,
         aliq_icms=$7, red_bc_icms=$8, cst_ipi=$9, aliq_ipi=$10, cest=$11,
         mva=$12, aliq_icms_st=$13, cbenef=$14, base_legal=$15, fcp=$17
       RETURNING *`,
      [
        ncm, uf, regra.descricao || '',
        regra.cstIcmsNormal || null, regra.csosnSimples || null, regra.cfopSaida || '5102',
        regra.aliqIcms || null, regra.redBcIcms || null,
        regra.cstIpi || '53', regra.aliqIpi || null,
        regra.cest || null, regra.mva || null, regra.aliqIcmsSt || null,
        regra.cbenef || null, regra.baseLegal || null,
        cnpj, regra.fcp || null,
      ],
    );
    return this.rowToRegra(r.rows[0]);
  }

  /**
   * Apaga a regra. Com `empresaCnpj`, só apaga o que é da própria empresa —
   * senão um cliente removeria a regra global e mudaria o imposto de todos.
   */
  async removerRegra(id: number, empresaCnpj?: string): Promise<boolean> {
    const cnpj = empresaCnpj ? empresaCnpj.replace(/\D/g, '') : null;
    const r = cnpj
      ? await this.pool.query(
          `DELETE FROM webapp_regras_fiscais WHERE id = $1 AND empresa_cnpj = $2`, [id, cnpj])
      : await this.pool.query(`DELETE FROM webapp_regras_fiscais WHERE id = $1`, [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async buscarRegraComoClassificacao(
    ncm8: string,
    uf: string,
    regime: 'simples' | 'normal',
    empresaCnpj?: string,
  ): Promise<any | null> {
    // A regra da própria empresa vence a global. O ORDER BY coloca primeiro a
    // que tem CNPJ (false ordena antes de true), e o LIMIT 1 fica com ela.
    const cnpj = empresaCnpj ? empresaCnpj.replace(/\D/g, '') : null;
    const r = await this.pool.query(
      `SELECT * FROM webapp_regras_fiscais
        WHERE ncm = $1 AND uf = $2 AND (empresa_cnpj IS NULL OR empresa_cnpj = $3)
        ORDER BY (empresa_cnpj IS NULL)
        LIMIT 1`,
      [ncm8.replace(/\D/g, ''), uf.toUpperCase(), cnpj],
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    const temST = Boolean(row.cest) || Number(row.mva) > 0 || Number(row.aliq_icms_st) > 0;
    return {
      ncm: ncm8,
      descricao: row.descricao || '',
      origem: '0',
      cstCsosn: regime === 'simples'
        ? (row.csosn_simples || (temST ? '500' : '102'))
        : (row.cst_icms_normal || (temST ? '10' : '00')),
      cfop: row.cfop_saida || '5102',
      aliqIcms: row.aliq_icms || undefined,
      redBcIcms: Number(row.red_bc_icms) > 0 ? row.red_bc_icms : undefined,
      cstIpi: row.cst_ipi || '53',
      aliqIpi: Number(row.aliq_ipi) > 0 ? row.aliq_ipi : undefined,
      cest: row.cest || undefined,
      mva: Number(row.mva) > 0 ? row.mva : undefined,
      aliqIcmsSt: Number(row.aliq_icms_st) > 0 ? row.aliq_icms_st : undefined,
      cstPis: '99',
      cstCofins: '99',
      cbenef: row.cbenef || undefined,
      baseLegal: row.base_legal || undefined,
      temST,
      fonte: 'regra_local',
    };
  }

  private rowToRegra(r: any): RegraFiscal {
    return {
      id: r.id,
      ncm: r.ncm,
      uf: r.uf,
      descricao: r.descricao,
      cstIcmsNormal: r.cst_icms_normal ?? undefined,
      csosnSimples: r.csosn_simples ?? undefined,
      cfopSaida: r.cfop_saida ?? undefined,
      aliqIcms: r.aliq_icms ?? undefined,
      redBcIcms: r.red_bc_icms ?? undefined,
      cstIpi: r.cst_ipi ?? undefined,
      aliqIpi: r.aliq_ipi ?? undefined,
      cest: r.cest ?? undefined,
      mva: r.mva ?? undefined,
      aliqIcmsSt: r.aliq_icms_st ?? undefined,
      cbenef: r.cbenef ?? undefined,
      fcp: r.fcp ?? undefined,
      baseLegal: r.base_legal ?? undefined,
      empresaCnpj: r.empresa_cnpj ?? undefined,
    };
  }
}
