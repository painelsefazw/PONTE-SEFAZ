import * as fs from 'fs';
import * as path from 'path';

/**
 * Rota por `:cnpj` tem que enxergar as DUAS entidades.
 *
 * `getEmpresaStore()` conhece so os EMITENTES. Numa ponte de revenda o cliente
 * nao esta la: ele e cliente de API, com cadastro fiscal e certificado
 * proprios, noutra tabela. `resolveEmpresa` ja fazia essa juncao para o header
 * `x-empresa-cnpj`; faltava para o parametro da URL.
 *
 * A rota que mais sofria era a de CREDENCIAMENTO — justamente a que responde
 * "por que a SEFAZ recusou a emissao desta empresa". Ela devolvia
 * "Empresa nao cadastrada" para um cliente que existe, tem certificado no
 * banco e tinha acabado de consultar o status da SEFAZ com ele.
 *
 * O contorno importa tanto quanto o conserto: `sincronizar-ie` ESCREVE, e
 * continua lendo do store onde grava. Ler de uma tabela e gravar noutra faria
 * a consulta acertar e a correcao se perder, calada.
 */

const app = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8').replace(/\r\n/g, '\n');

function rota(caminho: string): string {
  const i = app.indexOf(`'${caminho}'`);
  expect(i).toBeGreaterThan(-1);
  const resto = app.slice(i);
  const m = resto.slice(10).search(/\napp\.(get|post|put|delete)\(/);
  return m > -1 ? resto.slice(0, m + 10) : resto;
}

describe('rotas por :cnpj enxergam cliente de API', () => {
  test('existe um resolvedor que junta as duas tabelas', () => {
    expect(app).toContain('async function empresaPorCnpj(');
    const fn = app.slice(app.indexOf('async function empresaPorCnpj('));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    expect(corpo).toContain('getEmpresaStore()');
    expect(corpo).toContain('obterContextoFiscal');
  });

  test('o credenciamento usa o resolvedor — e nao so os emitentes', () => {
    const r = rota('/api/empresas/:cnpj/credenciamento');
    expect(r).toContain('await empresaPorCnpj(alvo)');
    expect(r).not.toContain('await store.obterContexto(alvo)');
  });

  test('a sincronizacao de IE continua lendo de onde ESCREVE', () => {
    // Nao e esquecimento: e o contrario do bug. Esta rota grava a IE
    // corrigida no store de emitentes; aceitar um cliente de API aqui leria de
    // uma tabela e gravaria noutra.
    const r = rota('/api/empresas/:cnpj/sincronizar-ie');
    expect(r).toContain('const store = await getEmpresaStore();');
    expect(r).toContain('store.atualizarIe(');
    expect(r).not.toContain('empresaPorCnpj');
  });
});
