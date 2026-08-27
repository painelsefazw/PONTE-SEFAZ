/**
 * Base de NCM própria, com busca por descrição.
 *
 * A base externa que existia antes procurava só a **primeira palavra** da
 * consulta, por prefixo, numa tabela de palavras-chave que sequer continha
 * "bisturi". Na prática: "caneta de bisturi elétrica" devolvia canetas
 * esferográficas, e "bisturi" sozinho não devolvia nada.
 *
 * A fonte aqui é a tabela oficial do MDIC (Comex Stat), com 13.745 códigos. O
 * detalhe que a torna utilizável é que as descrições **já vêm com o contexto
 * da hierarquia**:
 *
 *     90189021   Bisturis elétricos      (e não apenas "Elétricos")
 *     90189029   Outros bisturis         (e não apenas "Outros")
 *
 * Na tabela crua da Receita o código folha diz só "Elétricos", que sozinho não
 * casa com busca nenhuma — é por isso que classificar NCM pela descrição
 * costuma não funcionar.
 */
import { Pool } from 'pg';

/** Onde o MDIC publica a tabela. CSV em latin1, separado por ponto e vírgula. */
const FONTE_OFICIAL = 'https://balanca.economia.gov.br/balanca/bd/tabelas/NCM.csv';

export interface NcmItem {
  codigo: string;
  descricao: string;
  /** De onde veio a sugestão: o catálogo da casa ou a tabela oficial. */
  origem?: 'catalogo' | 'oficial';
  /** Quantas vezes esse par descrição/NCM já foi usado no catálogo. */
  usos?: number;
}

export class NcmStore {
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
      CREATE TABLE IF NOT EXISTS webapp_ncm (
        codigo VARCHAR(8) PRIMARY KEY,
        descricao TEXT NOT NULL,
        busca tsvector,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // GIN é o índice que faz a busca textual não varrer as 13 mil linhas.
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_webapp_ncm_busca ON webapp_ncm USING GIN (busca);`,
    );

    /**
     * Frequência de cada termo na base inteira.
     *
     * É o que faz "placa de bisturi" devolver bisturi, e não placa de metal:
     * "bisturi" aparece em 2 das 13.745 linhas e "placa" em centenas, então
     * casar com o termo raro vale muito mais. Sem isso os dois contam igual e
     * o comum vence pela quantidade.
     */
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_ncm_termo (
        palavra TEXT PRIMARY KEY,
        ndoc INTEGER NOT NULL
      );
    `);

    // pg_trgm dá a comparação por semelhança usada na busca no catálogo. Se o
    // banco não permitir criar a extensão, a busca no catálogo cai para ILIKE
    // — menos tolerante a variação, mas ainda útil.
    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      this.temTrigrama = true;
    } catch {
      this.temTrigrama = false;
    }

    this.initialized = true;
  }

  private temTrigrama = false;

  async total(): Promise<number> {
    const r = await this.pool.query('SELECT COUNT(*)::int AS n FROM webapp_ncm');
    return r.rows[0]?.n ?? 0;
  }

  async atualizadoEm(): Promise<string | null> {
    const r = await this.pool.query('SELECT MAX(atualizado_em) AS q FROM webapp_ncm');
    const q = r.rows[0]?.q;
    return q ? new Date(q).toISOString() : null;
  }

  /**
   * Baixa a tabela oficial e recarrega a base.
   *
   * O governo revisa a NCM periodicamente — códigos são criados e extintos —
   * então isto é para rodar de novo de tempos em tempos, não uma vez só.
   */
  async importarOficial(): Promise<{ total: number; termos: number }> {
    const resposta = await fetch(FONTE_OFICIAL);
    if (!resposta.ok) {
      throw new Error(`Nao foi possivel baixar a tabela do MDIC (HTTP ${resposta.status}).`);
    }
    // O arquivo é latin1: lido como UTF-8 os acentos viram lixo, e aí a busca
    // por "elétrico" deixa de casar.
    const csv = new TextDecoder('latin1').decode(await resposta.arrayBuffer());
    return this.carregarCsv(csv);
  }

  /** Separado do download para poder ser testado sem rede. */
  async carregarCsv(csv: string): Promise<{ total: number; termos: number }> {
    const linhas = csv.split('\n');
    const cabecalho = linhas[0].split(';').map((s) => s.replace(/"/g, '').trim());
    const iCodigo = cabecalho.indexOf('CO_NCM');
    const iDescricao = cabecalho.indexOf('NO_NCM_POR');
    if (iCodigo < 0 || iDescricao < 0) {
      throw new Error('Formato inesperado: a tabela do MDIC deveria ter CO_NCM e NO_NCM_POR.');
    }

    const itens: NcmItem[] = [];
    for (const linha of linhas.slice(1)) {
      const col = linha.split(';').map((s) => s.replace(/"/g, '').trim());
      const codigo = (col[iCodigo] || '').replace(/\D/g, '');
      const descricao = col[iDescricao] || '';
      // Só os códigos de 8 dígitos: os demais são níveis intermediários da
      // hierarquia e não podem ir numa nota.
      if (codigo.length === 8 && descricao) itens.push({ codigo, descricao });
    }
    if (!itens.length) throw new Error('A tabela veio vazia — importacao abortada.');

    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      // Recarga completa dentro da transação: se algo falhar no meio, a base
      // antiga continua servindo em vez de ficar pela metade.
      await cliente.query('DELETE FROM webapp_ncm');

      const LOTE = 500;
      for (let i = 0; i < itens.length; i += LOTE) {
        const fatia = itens.slice(i, i + LOTE);
        const valores: string[] = [];
        const params: string[] = [];
        fatia.forEach((it, j) => {
          const p = j * 2;
          valores.push(`($${p + 1}, $${p + 2}, to_tsvector('portuguese', $${p + 2}))`);
          params.push(it.codigo, it.descricao);
        });
        await cliente.query(
          `INSERT INTO webapp_ncm (codigo, descricao, busca) VALUES ${valores.join(',')}
           ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao, busca = EXCLUDED.busca`,
          params,
        );
      }

      // ts_stat percorre a base e conta em quantas linhas cada termo aparece.
      await cliente.query('DELETE FROM webapp_ncm_termo');
      await cliente.query(`
        INSERT INTO webapp_ncm_termo (palavra, ndoc)
        SELECT word, ndoc FROM ts_stat('SELECT busca FROM webapp_ncm')
        ON CONFLICT (palavra) DO UPDATE SET ndoc = EXCLUDED.ndoc
      `);

      await cliente.query('COMMIT');
    } catch (err) {
      await cliente.query('ROLLBACK');
      throw err;
    } finally {
      cliente.release();
    }

    const termos = (await this.pool.query('SELECT COUNT(*)::int AS n FROM webapp_ncm_termo')).rows[0].n;
    return { total: itens.length, termos };
  }

  /**
   * Busca NCM pela descrição do produto.
   *
   * Duas coisas fazem funcionar, e as duas foram medidas contra buscas reais:
   *
   * 1. O dicionário português do Postgres, que sabe que "seringas" e "seringa"
   *    são a mesma palavra. Tentar isso na mão cortando o "s" final quebra:
   *    "seringas" vira "sering" e deixa de casar com "seringa".
   * 2. O peso por raridade. Sem ele "placa de bisturi" cai em placa de metal.
   *
   * Devolve os códigos de 8 dígitos com a descrição oficial ao lado — é uma
   * busca melhor, não um classificador: quem escolhe continua sendo quem
   * entende do produto.
   */
  async buscar(consulta: string, limite = 8): Promise<NcmItem[]> {
    const q = String(consulta || '').trim();
    if (q.length < 2) return [];

    const r = await this.pool.query(
      `
      WITH termos AS (
        SELECT DISTINCT lexeme
          FROM unnest(tsvector_to_array(to_tsvector('portuguese', $1))) AS lexeme
      ),
      pesos AS (
        SELECT t.lexeme,
               -- Termo ausente da base é tratado como raríssimo: se casar em
               -- algum lugar, é sinal forte.
               ln(GREATEST((SELECT COUNT(*) FROM webapp_ncm), 1)::float
                  / GREATEST(COALESCE(f.ndoc, 1), 1)) AS peso
          FROM termos t
          LEFT JOIN webapp_ncm_termo f ON f.palavra = t.lexeme
      ),
      -- O OR reduz as 13 mil linhas às candidatas usando o índice GIN; a
      -- pontuação por termo roda só sobre esse punhado.
      candidatos AS (
        SELECT n.codigo, n.descricao, n.busca
          FROM webapp_ncm n
         WHERE n.busca @@ (SELECT to_tsquery('portuguese', string_agg(lexeme, ' | ')) FROM termos)
         LIMIT 400
      )
      SELECT c.codigo, c.descricao,
             SUM(p.peso)
               -- Cobrir mais termos da busca conta ao quadrado: casar 2 de 2
               -- vale muito mais que casar 2 de 4.
               * POWER(COUNT(*)::float / GREATEST((SELECT COUNT(*) FROM termos), 1), 2)
               -- Descrição curta tende a ser a mais específica.
               - LENGTH(c.descricao) / 600.0 AS score
        FROM candidatos c
        JOIN pesos p ON c.busca @@ to_tsquery('portuguese', p.lexeme)
       GROUP BY c.codigo, c.descricao
       ORDER BY score DESC
       LIMIT $2
      `,
      [q, limite],
    );

    return r.rows.map((row) => ({
      codigo: row.codigo,
      descricao: row.descricao,
      origem: 'oficial' as const,
    }));
  }

  /**
   * O que a casa já classificou para uma descrição parecida.
   *
   * É o sinal mais forte que existe: se alguém já cadastrou "CANETA DE BISTURI
   * ELETRICA" com um NCM, isso vale mais do que qualquer busca textual na
   * tabela oficial — foi uma decisão tomada por quem conhece o produto.
   *
   * Olha o catálogo de todas as empresas de propósito: são 23 empresas do mesmo
   * escritório, e o acerto de uma serve para as outras.
   */
  async buscarNoCatalogo(consulta: string, limite = 3): Promise<NcmItem[]> {
    const q = String(consulta || '').trim();
    if (q.length < 3) return [];

    const sql = this.temTrigrama
      ? `SELECT p.ncm AS codigo,
                MIN(p.descricao) AS descricao,
                COUNT(*)::int AS usos,
                MAX(similarity(LOWER(p.descricao), LOWER($1))) AS parecenca
           FROM webapp_produtos p
          WHERE p.ativo = TRUE
            AND LENGTH(COALESCE(p.ncm, '')) = 8
            AND similarity(LOWER(p.descricao), LOWER($1)) > 0.35
          GROUP BY p.ncm
          ORDER BY parecenca DESC, usos DESC
          LIMIT $2`
      : `SELECT p.ncm AS codigo,
                MIN(p.descricao) AS descricao,
                COUNT(*)::int AS usos,
                0 AS parecenca
           FROM webapp_produtos p
          WHERE p.ativo = TRUE
            AND LENGTH(COALESCE(p.ncm, '')) = 8
            AND LOWER(p.descricao) LIKE '%' || LOWER($1) || '%'
          GROUP BY p.ncm
          ORDER BY usos DESC
          LIMIT $2`;

    let r;
    try {
      r = await this.pool.query(sql, [q, limite]);
    } catch {
      // Catálogo indisponível não pode derrubar a busca na tabela oficial.
      return [];
    }

    return r.rows.map((row) => ({
      codigo: row.codigo,
      descricao: row.descricao,
      origem: 'catalogo' as const,
      usos: row.usos,
    }));
  }

  /** Descrição oficial de um código, para conferência. */
  async descrever(codigo: string): Promise<NcmItem | null> {
    const c = String(codigo || '').replace(/\D/g, '');
    if (c.length !== 8) return null;
    const r = await this.pool.query('SELECT codigo, descricao FROM webapp_ncm WHERE codigo = $1', [c]);
    return r.rows[0] ? { codigo: r.rows[0].codigo, descricao: r.rows[0].descricao, origem: 'oficial' } : null;
  }

  /**
   * Quais destes codigos NAO existem na tabela oficial.
   *
   * Uma query so para a nota inteira: conferir item a item numa nota de trinta
   * produtos seriam trinta idas ao banco no caminho da emissao.
   *
   * **Tabela vazia devolve lista vazia**, de proposito. A base da NCM e
   * importada a parte; se ela nunca foi carregada, TODO codigo pareceria
   * inexistente e o emissor pararia de emitir para todo mundo. Uma conferencia
   * que nao pode ser feita nao vira acusacao.
   */
  async inexistentes(codigos: string[]): Promise<string[]> {
    const limpos = [...new Set(
      codigos.map(c => String(c || '').replace(/\D/g, '')).filter(c => c.length === 8),
    )];
    if (!limpos.length) return [];

    const total = await this.pool.query('SELECT 1 FROM webapp_ncm LIMIT 1');
    if (!total.rows.length) return [];

    const r = await this.pool.query(
      'SELECT codigo FROM webapp_ncm WHERE codigo = ANY($1)', [limpos],
    );
    const existentes = new Set(r.rows.map(row => String(row.codigo)));
    return limpos.filter(c => !existentes.has(c));
  }
}
