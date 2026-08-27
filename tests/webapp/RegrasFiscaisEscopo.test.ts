import { ProdutoStore } from '../../src/webapp/produtos';

/**
 * Escopo das regras fiscais.
 *
 * A tabela é compartilhada entre todas as empresas — nasceu com uma regra por
 * (ncm, uf) valendo para todo mundo. Agora cada empresa grava a sua, e a dela
 * tem prioridade sobre a global na hora de classificar o produto.
 *
 * O que não pode acontecer, em nenhuma hipótese: uma empresa ler, sobrescrever
 * ou apagar a regra de outra. Isso mudaria o imposto de um cliente por ação de
 * outro, em silêncio, e só apareceria na nota emitida.
 */

const CNPJ_A = '66509026000178';
const CNPJ_B = '62050825000178';

type Chamada = { sql: string; params: unknown[] };

function store(): { store: ProdutoStore; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const pool: any = {
    async query(sql: string, params: unknown[] = []) {
      chamadas.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return { rows: [{ id: 1, ncm: '08031000', uf: 'MG' }], rowCount: 1 };
    },
  };
  return { store: new ProdutoStore(pool), chamadas };
}

const ultima = (c: Chamada[]) => c[c.length - 1]!;

describe('escopo das regras fiscais', () => {
  test('a empresa so enxerga as proprias regras e as globais', async () => {
    const { store: s, chamadas } = store();
    await s.listarRegras('MG', CNPJ_A);
    const { sql, params } = ultima(chamadas);
    expect(sql).toContain('empresa_cnpj IS NULL OR empresa_cnpj = $2');
    expect(params).toContain(CNPJ_A);
    // Sem o CNPJ de outra empresa em lugar nenhum da consulta.
    expect(params).not.toContain(CNPJ_B);
  });

  test('havendo regra propria e global para o mesmo NCM, a propria prevalece', async () => {
    const { store: s, chamadas } = store();
    await s.listarRegras('MG', CNPJ_A);
    const { sql } = ultima(chamadas);
    // DISTINCT ON (ncm) com a global ordenada por ultimo deixa so uma linha.
    expect(sql).toContain('DISTINCT ON (ncm)');
    expect(sql).toContain('ORDER BY ncm, (empresa_cnpj IS NULL)');
  });

  test('classificar prefere a regra da empresa a global', async () => {
    const { store: s, chamadas } = store();
    await s.buscarRegraComoClassificacao('08031000', 'MG', 'simples', CNPJ_A);
    const { sql, params } = ultima(chamadas);
    expect(sql).toContain('empresa_cnpj IS NULL OR empresa_cnpj = $3');
    expect(sql).toContain('ORDER BY (empresa_cnpj IS NULL)');
    expect(sql).toContain('LIMIT 1');
    expect(params[2]).toBe(CNPJ_A);
  });

  test('classificar sem empresa fica so com a global', async () => {
    const { store: s, chamadas } = store();
    await s.buscarRegraComoClassificacao('08031000', 'MG', 'simples');
    expect(ultima(chamadas).params[2]).toBeNull();
  });

  test('a empresa grava no proprio espaco, sem tocar na regra global', async () => {
    const { store: s, chamadas } = store();
    await s.salvarRegra({ ncm: '08031000', uf: 'MG' }, CNPJ_A);
    const { sql, params } = ultima(chamadas);
    expect(sql).toContain('ON CONFLICT (ncm, uf, empresa_cnpj) WHERE empresa_cnpj IS NOT NULL');
    expect(params[15]).toBe(CNPJ_A);
  });

  test('o administrador grava no espaco global', async () => {
    const { store: s, chamadas } = store();
    await s.salvarRegra({ ncm: '08031000', uf: 'MG' });
    const { sql, params } = ultima(chamadas);
    expect(sql).toContain('ON CONFLICT (ncm, uf) WHERE empresa_cnpj IS NULL');
    expect(params[15]).toBeNull();
  });

  test('a empresa so apaga o que e dela', async () => {
    const { store: s, chamadas } = store();
    await s.removerRegra(7, CNPJ_A);
    const { sql, params } = ultima(chamadas);
    expect(sql).toContain('WHERE id = $1 AND empresa_cnpj = $2');
    expect(params).toEqual([7, CNPJ_A]);
  });

  test('apagar regra fora do escopo nao remove nada e avisa', async () => {
    const chamadas: Chamada[] = [];
    const pool: any = {
      async query(sql: string, params: unknown[] = []) {
        chamadas.push({ sql, params });
        return { rows: [], rowCount: 0 }; // a regra e global ou de outra empresa
      },
    };
    const removeu = await new ProdutoStore(pool).removerRegra(7, CNPJ_A);
    expect(removeu).toBe(false);
  });

  test('o administrador apaga sem restricao de escopo', async () => {
    const { store: s, chamadas } = store();
    await s.removerRegra(7);
    expect(ultima(chamadas).sql).not.toContain('empresa_cnpj');
  });
});
