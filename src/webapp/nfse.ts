/**
 * Persistência da NFS-e: numeração da DPS, notas emitidas e catálogo de
 * serviços por empresa.
 *
 * Tabelas próprias, e não as da NF-e, por dois motivos concretos: a chave da
 * NFS-e tem 50 posições contra as 44 de `webapp_notas.chave_acesso`, e a
 * numeração da DPS é uma sequência independente da série da NF-e — a mesma
 * empresa pode estar na nota 800 de produto e na 1 de serviço.
 */
import { Pool } from 'pg';

export interface NfseRecord {
  chaveAcesso: string;
  empresaCnpj: string;
  /** Número da NFS-e atribuído pelo Sistema Nacional. */
  numero?: string;
  /** Série e número da DPS que originou a nota. */
  serie: string;
  numeroDps: string;
  idDps?: string;
  ambiente: string;
  tomadorNome: string;
  tomadorDoc: string;
  codigoServico?: string;
  descricaoServico?: string;
  valorServico: string;
  valorIssqn?: string;
  valorLiquido?: string;
  status: string;
  xml?: string;
  emitidaEm: string;
}

export interface ServicoCatalogo {
  id?: number;
  empresaCnpj: string;
  codigo: string;
  descricao: string;
  /** cTribNac de 6 dígitos. */
  codigoTributacaoNacional: string;
  codigoTributacaoMunicipal?: string;
  codigoNBS?: string;
  valorPadrao?: string;
  aliquotaIss?: string;
  tributacaoIssqn: string;
  issRetido: string;
  /**
   * Percentuais das retencoes FEDERAIS que este servico costuma sofrer.
   *
   * Guardar o percentual, e nao o valor, e o mesmo criterio do ISS: o valor
   * muda a cada nota, a aliquota e caracteristica do servico. Quem decide se
   * retem e o tomador (regra geral: pessoa juridica retem, pessoa fisica nao),
   * entao isto e sugestao — a emissao mostra o valor calculado e deixa mexer.
   */
  aliqIrrf?: string;
  aliqCsll?: string;
  aliqInss?: string;
  aliqPis?: string;
  aliqCofins?: string;
}

/**
 * NFS-e capturada do ambiente nacional.
 *
 * Não foi emitida por nós: veio do sistema do município e chegou ao ADN, de
 * onde a empresa baixa com o próprio certificado. Para a contabilidade é o que
 * hoje tem valor prático — o Emissor Nacional não atende nenhum dos municípios
 * das empresas cadastradas.
 */
export interface NfseRecebida {
  chaveAcesso: string;
  /** Empresa que baixou o documento (o dono do certificado). */
  empresaCnpj: string;
  /** Número sequencial no ambiente nacional. */
  nsu: number;
  tipoDocumento: string;
  numero?: string;
  emitenteCnpj?: string;
  emitenteNome?: string;
  tomadorDoc?: string;
  tomadorNome?: string;
  descricaoServico?: string;
  valorServico?: string;
  valorLiquido?: string;
  localEmissao?: string;
  emitidaEm?: string;
  xml?: string;
}

function paraRecebida(r: any): NfseRecebida {
  return {
    chaveAcesso: r.chave_acesso,
    empresaCnpj: r.empresa_cnpj,
    nsu: Number(r.nsu),
    tipoDocumento: r.tipo_documento,
    numero: r.numero ?? undefined,
    emitenteCnpj: r.emitente_cnpj ?? undefined,
    emitenteNome: r.emitente_nome ?? undefined,
    tomadorDoc: r.tomador_doc ?? undefined,
    tomadorNome: r.tomador_nome ?? undefined,
    descricaoServico: r.descricao_servico ?? undefined,
    valorServico: r.valor_servico != null ? String(r.valor_servico) : undefined,
    valorLiquido: r.valor_liquido != null ? String(r.valor_liquido) : undefined,
    localEmissao: r.local_emissao ?? undefined,
    emitidaEm: r.emitida_em instanceof Date ? r.emitida_em.toISOString() : (r.emitida_em ?? undefined),
  };
}

function paraNota(r: any): NfseRecord {
  return {
    chaveAcesso: r.chave_acesso,
    empresaCnpj: r.empresa_cnpj,
    numero: r.numero ?? undefined,
    serie: r.serie,
    numeroDps: r.numero_dps,
    idDps: r.id_dps ?? undefined,
    ambiente: r.ambiente,
    tomadorNome: r.tomador_nome,
    tomadorDoc: r.tomador_doc,
    codigoServico: r.codigo_servico ?? undefined,
    descricaoServico: r.descricao_servico ?? undefined,
    valorServico: r.valor_servico != null ? String(r.valor_servico) : '0.00',
    valorIssqn: r.valor_issqn != null ? String(r.valor_issqn) : undefined,
    valorLiquido: r.valor_liquido != null ? String(r.valor_liquido) : undefined,
    status: r.status,
    xml: r.xml ?? undefined,
    emitidaEm: r.emitida_em instanceof Date ? r.emitida_em.toISOString() : String(r.emitida_em),
  };
}

function paraServico(r: any): ServicoCatalogo {
  return {
    id: r.id,
    empresaCnpj: r.empresa_cnpj,
    codigo: r.codigo,
    descricao: r.descricao,
    codigoTributacaoNacional: r.ctrib_nac,
    codigoTributacaoMunicipal: r.ctrib_mun ?? undefined,
    codigoNBS: r.cnbs ?? undefined,
    valorPadrao: r.valor_padrao != null ? String(r.valor_padrao) : undefined,
    aliquotaIss: r.aliq_iss ?? undefined,
    tributacaoIssqn: r.trib_issqn,
    issRetido: r.iss_retido,
    aliqIrrf: r.aliq_irrf ?? undefined,
    aliqCsll: r.aliq_csll ?? undefined,
    aliqInss: r.aliq_inss ?? undefined,
    aliqPis: r.aliq_pis ?? undefined,
    aliqCofins: r.aliq_cofins ?? undefined,
  };
}

export class NfseStore {
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
      CREATE TABLE IF NOT EXISTS webapp_nfse_sequencia (
        cnpj VARCHAR(14) NOT NULL,
        serie TEXT NOT NULL,
        ambiente VARCHAR(1) NOT NULL DEFAULT '2',
        ultimo INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (cnpj, serie, ambiente)
      );
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_nfse (
        chave_acesso VARCHAR(50) PRIMARY KEY,
        empresa_cnpj VARCHAR(14) NOT NULL,
        numero TEXT,
        serie TEXT NOT NULL,
        numero_dps TEXT NOT NULL,
        id_dps TEXT,
        ambiente VARCHAR(1) NOT NULL,
        tomador_nome TEXT NOT NULL DEFAULT '',
        tomador_doc TEXT NOT NULL DEFAULT '',
        codigo_servico TEXT,
        descricao_servico TEXT,
        valor_servico NUMERIC(15,2) NOT NULL DEFAULT 0,
        valor_issqn NUMERIC(15,2),
        valor_liquido NUMERIC(15,2),
        status TEXT NOT NULL DEFAULT 'AUTORIZADA',
        xml TEXT,
        emitida_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_webapp_nfse_empresa ON webapp_nfse (empresa_cnpj, emitida_em DESC);`,
    );

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_servicos (
        id SERIAL PRIMARY KEY,
        empresa_cnpj VARCHAR(14) NOT NULL,
        codigo TEXT NOT NULL,
        descricao TEXT NOT NULL,
        ctrib_nac TEXT NOT NULL,
        ctrib_mun TEXT,
        cnbs TEXT,
        valor_padrao NUMERIC(15,2),
        aliq_iss TEXT,
        trib_issqn TEXT NOT NULL DEFAULT '1',
        iss_retido TEXT NOT NULL DEFAULT '1',
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (empresa_cnpj, codigo)
      );
    `);

    // Retencoes federais por servico. O gerador do XML ja sabia emitir vRetIRRF,
    // vRetCSLL, vRetCP e o grupo de PIS/COFINS; nao havia onde guardar a
    // aliquota de cada um, entao ninguem preenchia e a nota saia sem retencao —
    // com tomador pessoa juridica isso e rotina, nao excecao.
    for (const col of [
      'aliq_irrf TEXT', 'aliq_csll TEXT', 'aliq_inss TEXT',
      'aliq_pis TEXT', 'aliq_cofins TEXT',
    ]) {
      await this.pool.query(`ALTER TABLE webapp_servicos ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    }

    // A primeira versão criou iss_retido com default '2', que no XSD significa
    // "retido pelo tomador" — o oposto do pretendido. CREATE TABLE IF NOT
    // EXISTS não corrige coluna de tabela que já existe, então corrige aqui.
    await this.pool.query(`ALTER TABLE webapp_servicos ALTER COLUMN iss_retido SET DEFAULT '1'`);

    // NFS-e baixadas do ambiente nacional — emitidas pelo sistema do município
    // e não por nós. Tabela separada das que emitimos: a origem é outra, e
    // misturar as duas confunde o que é acervo próprio com o que é captura.
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_nfse_recebidas (
        chave_acesso VARCHAR(50) PRIMARY KEY,
        empresa_cnpj VARCHAR(14) NOT NULL,
        nsu BIGINT NOT NULL,
        tipo_documento TEXT NOT NULL DEFAULT 'NFSE',
        numero TEXT,
        emitente_cnpj TEXT,
        emitente_nome TEXT,
        tomador_doc TEXT,
        tomador_nome TEXT,
        descricao_servico TEXT,
        valor_servico NUMERIC(15,2),
        valor_liquido NUMERIC(15,2),
        local_emissao TEXT,
        emitida_em TIMESTAMPTZ,
        xml TEXT,
        capturada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_nfse_recebidas_empresa ON webapp_nfse_recebidas (empresa_cnpj, emitida_em DESC);`,
    );
    // Ponteiro de leitura por empresa: a distribuição é incremental por NSU.
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_nfse_nsu (
        cnpj VARCHAR(14) NOT NULL,
        ambiente VARCHAR(1) NOT NULL DEFAULT '1',
        ultimo_nsu BIGINT NOT NULL DEFAULT 0,
        sincronizado_em TIMESTAMPTZ,
        PRIMARY KEY (cnpj, ambiente)
      );
    `);

    this.initialized = true;
  }

  // --- numeração da DPS -----------------------------------------------------

  /**
   * Próximo número livre.
   *
   * A sequência é por ambiente, e não só por série: os testes em produção
   * restrita consumiriam a numeração de produção, que é a armadilha que já
   * apareceu na NF-e.
   */
  async proximoNumero(empresaCnpj: string, serie: string, ambiente: string): Promise<number> {
    const r = await this.pool.query(
      'SELECT ultimo FROM webapp_nfse_sequencia WHERE cnpj = $1 AND serie = $2 AND ambiente = $3',
      [empresaCnpj, serie, ambiente],
    );
    return (r.rows[0]?.ultimo ?? 0) + 1;
  }

  /** Avança para max(atual, numero) — atômico, seguro com emissões simultâneas. */
  async registrarNumeroUsado(
    empresaCnpj: string, serie: string, ambiente: string, numero: number,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO webapp_nfse_sequencia (cnpj, serie, ambiente, ultimo) VALUES ($1,$2,$3,$4)
       ON CONFLICT (cnpj, serie, ambiente)
       DO UPDATE SET ultimo = GREATEST(webapp_nfse_sequencia.ultimo, EXCLUDED.ultimo)`,
      [empresaCnpj, serie, ambiente, numero],
    );
  }

  // --- notas ----------------------------------------------------------------

  async salvarNota(n: NfseRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO webapp_nfse
        (chave_acesso, empresa_cnpj, numero, serie, numero_dps, id_dps, ambiente,
         tomador_nome, tomador_doc, codigo_servico, descricao_servico,
         valor_servico, valor_issqn, valor_liquido, status, xml, emitida_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (chave_acesso) DO NOTHING`,
      [
        n.chaveAcesso, n.empresaCnpj, n.numero ?? null, n.serie, n.numeroDps, n.idDps ?? null,
        n.ambiente, n.tomadorNome, n.tomadorDoc, n.codigoServico ?? null, n.descricaoServico ?? null,
        n.valorServico, n.valorIssqn ?? null, n.valorLiquido ?? null, n.status, n.xml ?? null,
        n.emitidaEm,
      ],
    );
  }

  async listarNotas(empresaCnpj?: string, limite = 100): Promise<NfseRecord[]> {
    const base = `SELECT chave_acesso, empresa_cnpj, numero, serie, numero_dps, id_dps, ambiente,
                         tomador_nome, tomador_doc, codigo_servico, descricao_servico,
                         valor_servico, valor_issqn, valor_liquido, status, emitida_em
                    FROM webapp_nfse`;
    const r = empresaCnpj
      ? await this.pool.query(`${base} WHERE empresa_cnpj = $2 ORDER BY emitida_em DESC LIMIT $1`, [limite, empresaCnpj])
      : await this.pool.query(`${base} ORDER BY emitida_em DESC LIMIT $1`, [limite]);
    return r.rows.map(paraNota);
  }

  async obterNota(chaveAcesso: string): Promise<NfseRecord | null> {
    const r = await this.pool.query('SELECT * FROM webapp_nfse WHERE chave_acesso = $1', [chaveAcesso]);
    return r.rows[0] ? paraNota(r.rows[0]) : null;
  }

  async atualizarStatus(chaveAcesso: string, status: string): Promise<void> {
    await this.pool.query('UPDATE webapp_nfse SET status = $2 WHERE chave_acesso = $1', [chaveAcesso, status]);
  }

  /** Remove as notas de produção restrita — as de produção nunca são tocadas. */
  async apagarHomologacao(empresaCnpj?: string): Promise<number> {
    const r = empresaCnpj
      ? await this.pool.query(`DELETE FROM webapp_nfse WHERE ambiente = '2' AND empresa_cnpj = $1`, [empresaCnpj])
      : await this.pool.query(`DELETE FROM webapp_nfse WHERE ambiente = '2'`);
    return r.rowCount ?? 0;
  }

  // --- distribuição: NFS-e baixadas do ambiente nacional ---------------------

  /** Último NSU lido para a empresa. A leitura recomeça daí. */
  async ultimoNsu(empresaCnpj: string, ambiente = '1'): Promise<number> {
    const r = await this.pool.query(
      'SELECT ultimo_nsu FROM webapp_nfse_nsu WHERE cnpj = $1 AND ambiente = $2',
      [empresaCnpj, ambiente],
    );
    return Number(r.rows[0]?.ultimo_nsu ?? 0);
  }

  /** Avança o ponteiro. Nunca retrocede, para não reprocessar em corrida. */
  async registrarNsu(empresaCnpj: string, nsu: number, ambiente = '1'): Promise<void> {
    await this.pool.query(
      `INSERT INTO webapp_nfse_nsu (cnpj, ambiente, ultimo_nsu, sincronizado_em)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (cnpj, ambiente) DO UPDATE
         SET ultimo_nsu = GREATEST(webapp_nfse_nsu.ultimo_nsu, EXCLUDED.ultimo_nsu),
             sincronizado_em = NOW()`,
      [empresaCnpj, ambiente, Math.floor(nsu)],
    );
  }

  /**
   * Guarda uma nota capturada.
   *
   * `DO NOTHING` no conflito: a mesma chave pode voltar numa releitura a partir
   * de um NSU anterior, e reescrever não acrescenta nada.
   */
  async salvarRecebida(n: NfseRecebida): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO webapp_nfse_recebidas
        (chave_acesso, empresa_cnpj, nsu, tipo_documento, numero, emitente_cnpj, emitente_nome,
         tomador_doc, tomador_nome, descricao_servico, valor_servico, valor_liquido,
         local_emissao, emitida_em, xml)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (chave_acesso) DO NOTHING`,
      [
        n.chaveAcesso, n.empresaCnpj, n.nsu, n.tipoDocumento, n.numero ?? null,
        n.emitenteCnpj ?? null, n.emitenteNome ?? null, n.tomadorDoc ?? null, n.tomadorNome ?? null,
        n.descricaoServico ?? null, n.valorServico ?? null, n.valorLiquido ?? null,
        n.localEmissao ?? null, n.emitidaEm ?? null, n.xml ?? null,
      ],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async listarRecebidas(empresaCnpj: string, limite = 100): Promise<NfseRecebida[]> {
    const r = await this.pool.query(
      `SELECT chave_acesso, empresa_cnpj, nsu, tipo_documento, numero, emitente_cnpj, emitente_nome,
              tomador_doc, tomador_nome, descricao_servico, valor_servico, valor_liquido,
              local_emissao, emitida_em
         FROM webapp_nfse_recebidas WHERE empresa_cnpj = $1
         ORDER BY emitida_em DESC NULLS LAST, nsu DESC LIMIT $2`,
      [empresaCnpj, limite],
    );
    return r.rows.map(paraRecebida);
  }

  async obterRecebida(chaveAcesso: string): Promise<NfseRecebida | null> {
    const r = await this.pool.query(
      'SELECT * FROM webapp_nfse_recebidas WHERE chave_acesso = $1',
      [chaveAcesso],
    );
    if (!r.rows[0]) return null;
    const n = paraRecebida(r.rows[0]);
    n.xml = r.rows[0].xml ?? undefined;
    return n;
  }

  // --- catálogo de serviços -------------------------------------------------

  async listarServicos(empresaCnpj: string): Promise<ServicoCatalogo[]> {
    const r = await this.pool.query(
      'SELECT * FROM webapp_servicos WHERE empresa_cnpj = $1 AND ativo = TRUE ORDER BY descricao',
      [empresaCnpj],
    );
    return r.rows.map(paraServico);
  }

  async salvarServico(s: ServicoCatalogo): Promise<ServicoCatalogo> {
    const r = await this.pool.query(
      `INSERT INTO webapp_servicos
        (empresa_cnpj, codigo, descricao, ctrib_nac, ctrib_mun, cnbs, valor_padrao,
         aliq_iss, trib_issqn, iss_retido, aliq_irrf, aliq_csll, aliq_inss, aliq_pis, aliq_cofins)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (empresa_cnpj, codigo) DO UPDATE SET
         descricao = EXCLUDED.descricao, ctrib_nac = EXCLUDED.ctrib_nac,
         ctrib_mun = EXCLUDED.ctrib_mun, cnbs = EXCLUDED.cnbs,
         valor_padrao = EXCLUDED.valor_padrao, aliq_iss = EXCLUDED.aliq_iss,
         trib_issqn = EXCLUDED.trib_issqn, iss_retido = EXCLUDED.iss_retido,
         aliq_irrf = EXCLUDED.aliq_irrf, aliq_csll = EXCLUDED.aliq_csll,
         aliq_inss = EXCLUDED.aliq_inss, aliq_pis = EXCLUDED.aliq_pis,
         aliq_cofins = EXCLUDED.aliq_cofins,
         ativo = TRUE
       RETURNING *`,
      [
        s.empresaCnpj, s.codigo, s.descricao, s.codigoTributacaoNacional,
        s.codigoTributacaoMunicipal ?? null, s.codigoNBS ?? null, s.valorPadrao ?? null,
        s.aliquotaIss ?? null, s.tributacaoIssqn, s.issRetido,
        s.aliqIrrf ?? null, s.aliqCsll ?? null, s.aliqInss ?? null,
        s.aliqPis ?? null, s.aliqCofins ?? null,
      ],
    );
    return paraServico(r.rows[0]);
  }

  async removerServico(empresaCnpj: string, id: number): Promise<boolean> {
    const r = await this.pool.query(
      'UPDATE webapp_servicos SET ativo = FALSE WHERE id = $1 AND empresa_cnpj = $2',
      [id, empresaCnpj],
    );
    return (r.rowCount ?? 0) > 0;
  }
}
