/**
 * Leitura do convênio do município no ADN.
 *
 * O que importa aqui é não confundir três estados diferentes:
 *
 *   pode emitir          — município aderente ao EMISSOR Nacional
 *   só recebe/distribui  — aderente apenas ao AMBIENTE Nacional
 *   não deu para saber   — ADN fora do ar, indisponível, sem resposta
 *
 * O terceiro é o perigoso: tratado como "não pode emitir", vira um bloqueio
 * falso; tratado como "pode", manda o operador preencher a nota para levar
 * E0039. Por isso `sucesso` é separado de `podeEmitir`.
 */
import { EventEmitter } from 'events';
import { SefinClient } from '../../src/infrastructure/nfse/SefinClient';

jest.mock('https', () => ({ request: jest.fn() }));
const https = require('https');

// O https é mockado, então o certificado nunca é usado de verdade; basta o
// SefinClient conseguir montar o PEM sem parsear o PFX (aqui vazio, de teste).
jest.mock('../../src/infrastructure/crypto/pfxPem', () => ({
  extractPemFromPfx: () => ({ cert: '', key: '', ca: [] }),
}));

/** Responde a próxima requisição HTTPS com um status e corpo fixos. */
function responderCom(status: number, corpo: string) {
  https.request.mockImplementation((_opts: any, cb: any) => {
    const res: any = new EventEmitter();
    res.statusCode = status;
    const req: any = new EventEmitter();
    req.end = () => {
      process.nextTick(() => {
        cb(res);
        res.emit('data', Buffer.from(corpo, 'utf-8'));
        res.emit('end');
      });
    };
    req.write = () => true;
    req.destroy = () => undefined;
    req.setTimeout = () => req;
    return req;
  });
  return https.request;
}

function cliente() {
  return new SefinClient({
    pfx: Buffer.from(''), senhaPfx: '', ambiente: '1', timeoutMs: 5000,
  });
}

describe('convenioMunicipio', () => {
  afterEach(() => jest.clearAllMocks());

  test('município aderente ao Emissor Nacional pode emitir', async () => {
    responderCom(200, JSON.stringify({
      aderenteEmissorNacional: 1, aderenteAmbienteNacional: 1,
    }));
    const r = await cliente().convenioMunicipio('3550308');
    expect(r).toMatchObject({ sucesso: true, podeEmitir: true, podeBaixar: true });
  });

  test('aderente só ao Ambiente Nacional recebe nota mas não emite', async () => {
    // É o caso de quem usa emissor próprio — a maioria.
    responderCom(200, JSON.stringify({
      aderenteEmissorNacional: 0, aderenteAmbienteNacional: 1,
    }));
    const r = await cliente().convenioMunicipio('3530607');
    expect(r.sucesso).toBe(true);
    expect(r.podeEmitir).toBe(false);
    expect(r.podeBaixar).toBe(true);
  });

  test('aceita booleano além de 1/0', async () => {
    responderCom(200, JSON.stringify({
      aderenteEmissorNacional: true, aderenteAmbienteNacional: false,
    }));
    const r = await cliente().convenioMunicipio('3530607');
    expect(r.podeEmitir).toBe(true);
    expect(r.podeBaixar).toBe(false);
  });

  test('falha de consulta não vira "não pode emitir"', async () => {
    responderCom(503, '<html>indisponivel</html>');
    const r = await cliente().convenioMunicipio('3530607');
    // sucesso=false é o que a tela usa para dizer "não consegui saber" em vez
    // de afirmar que a emissão está bloqueada.
    expect(r.sucesso).toBe(false);
    expect(r.podeEmitir).toBe(false);
    expect(r.erro).toBeTruthy();
  });

  test('resposta que não é JSON não derruba a consulta', async () => {
    responderCom(200, 'nao sou json');
    const r = await cliente().convenioMunicipio('3530607');
    expect(r.podeEmitir).toBe(false);
    expect(() => r).not.toThrow();
  });

  test('campo ausente é tratado como não aderente, não como erro', async () => {
    responderCom(200, JSON.stringify({ algumOutroCampo: 'x' }));
    const r = await cliente().convenioMunicipio('3530607');
    expect(r.sucesso).toBe(true);
    expect(r.podeEmitir).toBe(false);
    expect(r.podeBaixar).toBe(false);
  });

  test('limpa pontuação do código do município', async () => {
    const spy = responderCom(200, JSON.stringify({ aderenteEmissorNacional: 1 }));
    await cliente().convenioMunicipio('3.530.607');
    expect(spy.mock.calls[0][0]).toMatchObject({
      path: '/contribuintes/parametrizacao/3530607/convenio',
      hostname: 'adn.nfse.gov.br',
    });
  });
});
