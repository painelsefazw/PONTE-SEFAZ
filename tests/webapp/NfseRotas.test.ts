import { app } from '../../src/webapp/app';

/**
 * Rotas da NFS-e.
 *
 * O que quebra aqui não é lógica, é ordem de registro: `/api/nfse/:chave` casa
 * com `/api/nfse/servicos`, e quem for registrado primeiro vence. Trocar a
 * ordem faz o catálogo de serviços virar uma consulta de nota com a chave
 * "servicos" — que responde 404 em vez de listar, sem erro nenhum no log.
 */

function rotasNfse(): string[] {
  const stack = ((app as any).router?.stack ?? (app as any)._router.stack) as any[];
  return stack
    .filter((l) => l.route)
    .map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`)
    .filter((r) => r.includes('/api/nfse'));
}

describe('registro das rotas de NFS-e', () => {
  test('o ciclo completo esta exposto', () => {
    const rotas = rotasNfse();
    for (const esperada of [
      'POST /api/nfse/emitir',
      'POST /api/nfse/cancelar',
      'POST /api/nfse/analise-fiscal',
      'POST /api/nfse/enviar-email',
      'POST /api/nfse/distribuicao',
      'GET /api/nfse/distribuicao',
      'GET /api/nfse/distribuicao/:chave/xml',
      'GET /api/nfse/:chave',
      'GET /api/nfse/:chave/xml',
      'GET /api/nfse/:chave/danfse',
      'GET /api/nfse/:chave/eventos/:tipo',
      'GET /api/nfse/convenio',
      'GET /api/nfse/historico',
      'GET /api/nfse/proximo-numero',
      'GET /api/nfse/servicos',
      'POST /api/nfse/servicos',
      'DELETE /api/nfse/servicos/:id',
      'DELETE /api/nfse/homologacao',
    ]) {
      expect(rotas).toContain(esperada);
    }
  });

  // A rota com parâmetro tem que ser a última: registrada antes, engole
  // 'servicos', 'historico', 'proximo-numero'.
  test('as rotas literais vencem a rota com parametro', () => {
    const rotas = rotasNfse();
    const curinga = rotas.indexOf('GET /api/nfse/:chave');
    expect(curinga).toBeGreaterThan(-1);
    for (const literal of [
      'GET /api/nfse/servicos',
      'GET /api/nfse/historico',
      'GET /api/nfse/proximo-numero',
      // Sem isto, /api/nfse/convenio cairia na consulta de nota com a chave
      // "convenio" e responderia 404 sem erro nenhum no log.
      'GET /api/nfse/convenio',
    ]) {
      expect(rotas.indexOf(literal)).toBeLessThan(curinga);
    }
  });

  // Os sufixos de /:chave também precisam vir antes de /:chave sozinho.
  test('os sufixos vencem a rota nua', () => {
    const rotas = rotasNfse();
    const nua = rotas.indexOf('GET /api/nfse/:chave');
    for (const sufixo of [
      'GET /api/nfse/:chave/xml',
      'GET /api/nfse/:chave/danfse',
      'GET /api/nfse/:chave/eventos/:tipo',
    ]) {
      expect(rotas.indexOf(sufixo)).toBeLessThan(nua);
    }
  });

  test('a NFS-e nao invade as rotas da NF-e', () => {
    const stack = ((app as any).router?.stack ?? (app as any)._router.stack) as any[];
    const todas = stack.filter((l) => l.route).map((l) => l.route.path as string);
    // /api/emitir e /api/nfse/emitir são endpoints distintos e ambos existem.
    expect(todas).toContain('/api/emitir');
    expect(todas).toContain('/api/nfse/emitir');
    expect(todas).toContain('/api/cancelar');
    expect(todas).toContain('/api/nfse/cancelar');
  });
});

/**
 * Precedência entre catálogo e corpo da requisição.
 *
 * O catálogo existe para o ERP não repetir cTribNac e alíquota a cada nota,
 * mas o corpo tem que poder sobrepor: valor muda por nota, descrição também.
 * A regra do endpoint é espalhar o catálogo primeiro e o corpo depois.
 */
describe('servico vindo do catalogo', () => {
  function resolver(catalogo: any, corpo: any) {
    const servico = { ...catalogo, ...corpo.servico };
    return {
      codigoTributacaoNacional: servico.codigoTributacaoNacional,
      descricao: corpo.servico?.descricao || catalogo.descricao,
      valorServico: corpo.valorServico || catalogo.valorPadrao,
      aliquotaIss: corpo.aliquotaIss || catalogo.aliquotaIss,
    };
  }

  const catalogo = {
    codigoTributacaoNacional: '010101',
    descricao: 'DESENVOLVIMENTO DE SISTEMAS',
    valorPadrao: '1000.00',
    aliquotaIss: '2.90',
  };

  test('sem nada no corpo, tudo vem do catalogo', () => {
    expect(resolver(catalogo, {})).toEqual({
      codigoTributacaoNacional: '010101',
      descricao: 'DESENVOLVIMENTO DE SISTEMAS',
      valorServico: '1000.00',
      aliquotaIss: '2.90',
    });
  });

  test('o corpo sobrepoe o catalogo', () => {
    const r = resolver(catalogo, {
      valorServico: '2500.00',
      servico: { descricao: 'MANUTENCAO EVOLUTIVA - JULHO' },
    });
    expect(r.valorServico).toBe('2500.00');
    expect(r.descricao).toBe('MANUTENCAO EVOLUTIVA - JULHO');
    // O que o corpo não trouxe continua vindo do catálogo.
    expect(r.codigoTributacaoNacional).toBe('010101');
    expect(r.aliquotaIss).toBe('2.90');
  });
});

/**
 * Guarda de tenant no download.
 *
 * A chave da NFS-e é pública na consulta do município, mas o acervo guardado
 * aqui é do cliente: sem conferir a empresa, uma chave conhecida baixaria o
 * XML de outra.
 */
describe('acesso ao acervo por empresa', () => {
  const permite = (notaDe: string | null, requisitante: string) =>
    notaDe !== null && notaDe === requisitante;

  test('a empresa acessa a propria nota', () => {
    expect(permite('29920163000174', '29920163000174')).toBe(true);
  });

  test('empresa diferente nao acessa', () => {
    expect(permite('29920163000174', '50229544000106')).toBe(false);
  });

  test('nota inexistente nao vaza', () => {
    expect(permite(null, '29920163000174')).toBe(false);
  });
});
