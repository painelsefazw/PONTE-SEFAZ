import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { respostaDeEnvioSemResposta } from '../../src/webapp/app';
import { SoapClient, SoapError } from '../../src/infrastructure/soap/SoapClient';

/**
 * SEFAZ fora do ar nao e a mesma coisa que "nao sei se a nota saiu".
 *
 * As duas chegavam na mesma resposta, e a resposta era a da pior delas: o
 * operador era mandado consultar uma chave que nunca existiu, e cada tentativa
 * durante a queda queimava um numero — que depois so se fecha com inutilizacao.
 *
 * A regra que este arquivo trava: so se afirma "nao saiu" onde nao ha duvida.
 * Timeout e resposta perdida continuam sendo "nao sei", porque neles a nota
 * PODE estar autorizada — e afirmar o contrario produziria duplicidade.
 */

const ctx = {
  uf: 'MG',
  chave: '31260812345678000190550010000000011234567890',
  serie: '880',
  numero: '42',
  ambiente: '1',
  documento: 'nota' as const,
};

/** Erro como o SoapClient marca quando a requisicao nao chegou a sair. */
const naoSaiu = () => new SoapError('Erro de comunicacao com SEFAZ: connect ECONNREFUSED', undefined, undefined, true);
/** Timeout: a SEFAZ pode ter recebido, processado e autorizado. */
const naoSei = () => new SoapError('Timeout ao comunicar com SEFAZ (30000ms)');

describe('SEFAZ comprovadamente fora do ar', () => {
  test('devolve 503, nao 502', () => {
    // 502 é "o destino respondeu torto"; 503 é "o destino nao esta disponivel".
    // A diferenca importa para quem integra: um pede investigacao, o outro pede
    // esperar e tentar de novo.
    expect(respostaDeEnvioSemResposta(naoSaiu(), ctx).status).toBe(503);
  });

  test('afirma que a nota NAO foi emitida', () => {
    const { corpo } = respostaDeEnvioSemResposta(naoSaiu(), ctx);
    expect(corpo.erro).toMatch(/N[AÃ]O foi emitid/i);
    expect(corpo.sefazIndisponivel).toBe(true);
  });

  test('diz explicitamente que nao ha duvida', () => {
    // Sem o `indefinido: false` explicito, um integrador que so olha a presenca
    // do campo trataria a queda como caso indefinido e mandaria consultar.
    expect(respostaDeEnvioSemResposta(naoSaiu(), ctx).corpo.indefinido).toBe(false);
  });

  test('nomeia a UF — "a SEFAZ" sozinha nao diz qual caiu', () => {
    expect(respostaDeEnvioSemResposta(naoSaiu(), ctx).corpo.erro).toMatch(/MG/);
  });

  test('avisa que NAO ha contingencia, em vez de deixar esperando', () => {
    // O emissor nao implementa SVC. Quem nao sabe disso fica esperando um
    // desvio automatico que nunca vem.
    expect(respostaDeEnvioSemResposta(naoSaiu(), ctx).corpo.contingencia)
      .toMatch(/nao emite em contingencia/i);
  });

  test('nao manda consultar a chave — ela nunca existiu', () => {
    const { corpo } = respostaDeEnvioSemResposta(naoSaiu(), ctx);
    expect(String(corpo.comoResolver)).not.toMatch(/api\/consultar/);
    expect(corpo.chaveAcesso).toBeUndefined();
  });

  test('aponta para o /api/status, que e como se sabe que voltou', () => {
    expect(String(respostaDeEnvioSemResposta(naoSaiu(), ctx).corpo.comoResolver))
      .toMatch(/api\/status/);
  });

  test('libera o numero de volta', () => {
    // A nota nao existe: segurar o numero abriria um buraco na numeracao a cada
    // tentativa durante a queda.
    expect(respostaDeEnvioSemResposta(naoSaiu(), ctx).podeDevolverNumero).toBe(true);
  });

  test('no cupom a frase fala de cupom', () => {
    // A mesma funcao serve os dois documentos, e dizer "a nota" para quem esta
    // no caixa e o tipo de detalhe que faz o operador duvidar da mensagem.
    const cupom = respostaDeEnvioSemResposta(naoSaiu(), { ...ctx, documento: 'cupom' }).corpo;
    const nota = respostaDeEnvioSemResposta(naoSaiu(), ctx).corpo;
    expect(cupom.erro).toMatch(/O cupom N[AÃ]O foi emitido/);
    expect(nota.erro).toMatch(/A nota N[AÃ]O foi emitid/);
  });
});

describe('envio nao confirmado — o comportamento antigo, preservado', () => {
  test('continua 502 e continua indefinido', () => {
    const r = respostaDeEnvioSemResposta(naoSei(), ctx);
    expect(r.status).toBe(502);
    expect(r.corpo.indefinido).toBe(true);
  });

  test('devolve a chave, que e a unica coisa que resolve', () => {
    const { corpo } = respostaDeEnvioSemResposta(naoSei(), ctx);
    expect(corpo.chaveAcesso).toBe(ctx.chave);
    expect(String(corpo.comoResolver)).toMatch(/api\/consultar/);
  });

  test('NAO libera o numero', () => {
    // O ponto mais delicado dos dois: devolver um numero que pode estar
    // autorizado na SEFAZ recria exatamente a duplicidade que a reserva evita.
    expect(respostaDeEnvioSemResposta(naoSei(), ctx).podeDevolverNumero).toBe(false);
  });

  test('erro cru, sem marca nenhuma, cai no lado seguro', () => {
    // Erro desconhecido nao pode virar "nao saiu": na duvida, a nota pode existir.
    const r = respostaDeEnvioSemResposta(new Error('coisa estranha'), ctx);
    expect(r.status).toBe(502);
    expect(r.podeDevolverNumero).toBe(false);
  });
});

describe('SoapClient — quem marca "nao saiu"', () => {
  test('conexao recusada e marcada', async () => {
    // Porta 1 em localhost nao tem servidor: ECONNREFUSED na hora, sem rede.
    const cli = new SoapClient({ timeout: 5000 });
    await expect(cli.send('<x/>', 'http://127.0.0.1:1/nfe', 'NfeAutorizacao'))
      .rejects.toMatchObject({ naoTransmitiu: true });
  });

  describe('resposta HTTP do servidor da frente', () => {
    let server: http.Server;
    let porta = 0;
    let status = 503;

    beforeAll(async () => {
      server = http.createServer((_req, res) => { res.writeHead(status); res.end('indisponivel'); });
      await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
      porta = (server.address() as any).port;
    });

    afterAll(async () => {
      await new Promise<void>(ok => server.close(() => ok()));
    });

    test('503 e indisponibilidade: a aplicacao nem rodou', async () => {
      status = 503;
      const cli = new SoapClient({ timeout: 5000 });
      await expect(cli.send('<x/>', `http://127.0.0.1:${porta}/nfe`, 'NfeAutorizacao'))
        .rejects.toMatchObject({ naoTransmitiu: true });
    });

    test('500 NAO e marcado: pode ter quebrado depois de processar', async () => {
      // Erro interno e ambiguo por natureza. Tratar como "nao saiu" seria
      // afirmar mais do que se sabe, e o preco do engano e nota duplicada.
      status = 500;
      const cli = new SoapClient({ timeout: 5000 });
      await expect(cli.send('<x/>', `http://127.0.0.1:${porta}/nfe`, 'NfeAutorizacao'))
        .rejects.toMatchObject({ naoTransmitiu: false });
    });
  });
});

describe('a tela conta a mesma historia', () => {
  const painel = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8',
  );

  test('as duas telas de emissao chamam o mesmo tratamento', () => {
    // Queda da SEFAZ aparecia como "Rejeitada", que manda o operador procurar
    // defeito numa nota que esta certa. A NF-e e a NFC-e tem de dizer o mesmo.
    expect(painel.match(/falhaDeEnvio\(/g) || []).toHaveLength(3); // 1 definicao + 2 usos
  });

  test('detalhes em string nao estoura mais a tela', () => {
    // `detalhes.join` numa string virava TypeError, caia no catch e aparecia
    // "Erro de conexao" — escondendo justamente a mensagem que explicava o caso.
    expect(painel).toMatch(/Array\.isArray\(result\.detalhes\)/);
  });
});
