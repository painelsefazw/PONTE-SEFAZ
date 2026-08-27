import * as fs from 'fs';
import * as path from 'path';
import {
  erroDeDocumentosExcludentes,
  erroDeSerie,
  corrigirSentidoCfop,
} from '../../src/webapp/app';

/**
 * As guardas que a NF-e tinha e o cupom nao.
 *
 * Nenhuma destas conferencias e nova: todas existiam, escritas a mao, dentro de
 * `/api/emitir`. A rota irma nasceu depois e ficou sem elas — e o defeito nao
 * aparece em revisao porque cada rota, lida sozinha, parece completa.
 *
 * Por isso metade deste arquivo trava a FONTE e nao o comportamento: o que
 * precisa ser garantido e que as duas rotas chamem a mesma guarda, e que ela
 * rode no ponto certo. Guarda que roda depois da decisao e pior que guarda
 * nenhuma — ela esconde o defeito em vez de corrigi-lo.
 */

const fonte = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8',
);

/** O corpo de `/api/emitir-nfce`, da assinatura da rota ate a proxima rota. */
const corpoDoCupom = (() => {
  const inicio = fonte.indexOf("app.post('/api/emitir-nfce'");
  const fim = fonte.indexOf("app.get('/api/proximo-numero'", inicio);
  expect(inicio).toBeGreaterThan(-1);
  expect(fim).toBeGreaterThan(inicio);
  return fonte.slice(inicio, fim);
})();

describe('CNPJ e CPF juntos', () => {
  test('os dois preenchidos e recusa', () => {
    const erro = erroDeDocumentosExcludentes(
      { cnpj: '33645647000120', cpf: '11144477735' },
      { documentoOpcional: false },
    );
    expect(erro).toMatch(/sao excludentes/);
  });

  test('a recusa diz por que nao da para escolher um', () => {
    // Sem esta frase parece burocracia. O motivo e que o erro NAO gera rejeicao:
    // o gerador escolhe o CNPJ, o documento sai autorizado no nome do outro, e
    // quem descobre e o destinatario.
    const erro = erroDeDocumentosExcludentes(
      { cnpj: '33645647000120', cpf: '11144477735' },
      { documentoOpcional: false },
    );
    expect(erro).toMatch(/nome errado/);
  });

  test('pontuacao nao esconde o segundo documento', () => {
    // O caso real: o ERP manda os dois ja formatados. Comparar string vazia
    // deixaria passar, porque nenhum dos dois esta vazio.
    expect(erroDeDocumentosExcludentes(
      { cnpj: '33.645.647/0001-20', cpf: '111.444.777-35' },
      { documentoOpcional: false },
    )).toMatch(/sao excludentes/);
  });

  test('campo presente mas sem digito nao conta como preenchido', () => {
    // ERP que manda `cpf: '-'` ou `cnpj: '//'` tem um campo cheio de pontuacao e
    // documento nenhum. Recusar aqui barraria emissao legitima.
    expect(erroDeDocumentosExcludentes(
      { cnpj: '33645647000120', cpf: '   ' },
      { documentoOpcional: false },
    )).toBeUndefined();
    expect(erroDeDocumentosExcludentes(
      { cnpj: '33645647000120', cpf: '-' },
      { documentoOpcional: false },
    )).toBeUndefined();
  });

  test('so um documento passa, nos dois sentidos', () => {
    expect(erroDeDocumentosExcludentes({ cnpj: '33645647000120' }, { documentoOpcional: false }))
      .toBeUndefined();
    expect(erroDeDocumentosExcludentes({ cpf: '11144477735' }, { documentoOpcional: false }))
      .toBeUndefined();
  });

  test('cupom sem documento nenhum continua valendo', () => {
    // Consumidor nao identificado e o caso NORMAL do balcao — a maioria dos
    // cupons sai assim. Uma guarda que exigisse documento aqui pararia a loja.
    expect(erroDeDocumentosExcludentes(undefined, { documentoOpcional: true })).toBeUndefined();
    expect(erroDeDocumentosExcludentes({}, { documentoOpcional: true })).toBeUndefined();
  });

  test('destinatario ausente nao quebra na NF-e tambem', () => {
    expect(erroDeDocumentosExcludentes(undefined, { documentoOpcional: false })).toBeUndefined();
  });

  test('so o cupom ensina a omitir os dois', () => {
    // Na NF-e o conselho seria errado: nota de venda exige documento do
    // destinatario. A regra e a mesma nos dois; o que muda e a saida.
    const cupom = erroDeDocumentosExcludentes(
      { cnpj: '33645647000120', cpf: '11144477735' }, { documentoOpcional: true },
    );
    const nota = erroDeDocumentosExcludentes(
      { cnpj: '33645647000120', cpf: '11144477735' }, { documentoOpcional: false },
    );
    expect(cupom).toMatch(/omita os dois/);
    expect(nota).not.toMatch(/omita os dois/);
  });

  test('as duas rotas de emissao chamam a guarda', () => {
    // O defeito original era exatamente este: a conferencia existia, escrita a
    // mao, dentro de uma rota so.
    expect(fonte).toMatch(/erroDeDocumentosExcludentes\(body\.destinatario, \{ documentoOpcional: false \}\)/);
    expect(corpoDoCupom).toMatch(/erroDeDocumentosExcludentes\(body\.destinatario, \{ documentoOpcional: true \}\)/);
  });
});

describe('faixa da serie', () => {
  test('890 em diante e recusada', () => {
    for (const serie of ['890', '900', '999', 900]) {
      expect(erroDeSerie(serie)).toMatch(/890-999/);
    }
  });

  test('a recusa nomeia o cStat, que a SEFAZ nao explica', () => {
    expect(erroDeSerie('900')).toMatch(/244/);
  });

  test('a faixa normal passa inteira', () => {
    for (const serie of ['0', '1', '800', '880', '889', 889, undefined]) {
      expect(erroDeSerie(serie)).toBeUndefined();
    }
  });

  test('o cupom confere a serie ANTES de reservar numero', () => {
    // Reservar primeiro e recusar depois deixa um numero preso numa serie que
    // nunca vai emitir — e buraco de numeracao so se fecha inutilizando a faixa.
    const confere = corpoDoCupom.indexOf('erroDeSerie(body.serie)');
    const reserva = corpoDoCupom.indexOf('reservarNumero(');
    expect(confere).toBeGreaterThan(-1);
    expect(reserva).toBeGreaterThan(confere);
  });

  test('as duas rotas de emissao chamam a guarda', () => {
    expect(fonte.match(/erroDeSerie\(body\.serie\)/g) || []).toHaveLength(2);
  });
});

describe('CFOP do cupom', () => {
  test('no modelo 65 todo CFOP vira 5xxx', () => {
    // A NFC-e so existe como venda dentro do estado: qualquer primeiro digito
    // diferente de 5 esta errado por definicao. 6102 entra pelo catalogo de quem
    // tambem vende para fora; 1202 entra por item de devolucao.
    const { itens, ajustes } = corrigirSentidoCfop(
      [{ cfop: '6102' }, { cfop: '1202' }, { cfop: '5102' }],
      { entrada: false, destino: '1' },
    );
    expect(itens.map(i => i.cfop)).toEqual(['5102', '5202', '5102']);
    expect(ajustes).toEqual([
      { item: 1, de: '6102', para: '5102' },
      { item: 2, de: '1202', para: '5202' },
    ]);
  });

  test('a rota do cupom chama a correcao com sentido de saida interna', () => {
    expect(corpoDoCupom).toMatch(/corrigirSentidoCfop\(\s*normalizarItens\(body\.itens, emp\.crt\),\s*\{ entrada: false, destino: '1' \},?\s*\)/);
  });

  test('a correcao nao e muda: o cupom devolve cfopAjustado', () => {
    // Correcao silenciosa deixa o cadastro errado para sempre — quem integra
    // precisa saber que o CFOP que mandou nao e o que foi para o XML.
    expect(corpoDoCupom.match(/cfopAjustado\.length \? \{ cfopAjustado \} : \{\}/g) || [])
      .toHaveLength(2);
  });
});

describe('numero ja usado', () => {
  test('o cupom confere o historico antes de transmitir', () => {
    expect(corpoDoCupom).toMatch(/ja foi usado nesta empresa e ambiente/);
  });

  test('a conferencia so vale para numero vindo de fora', () => {
    // O numero reservado e novo por construcao: conferir o historico contra ele
    // seria uma consulta ao banco por cupom, no balcao, sem nada a decidir.
    expect(corpoDoCupom).toMatch(/if \(numeroPedido && !simulando\) \{/);
  });

  test('sem historico disponivel o cupom segue', () => {
    // Banco fora do ar nao pode impedir de faturar: a conferencia e rede de
    // seguranca, e quem decide de verdade e a SEFAZ.
    expect(corpoDoCupom).toMatch(/catch \{ \/\* sem historico disponivel/);
  });
});

describe('erro de cadastro no cupom', () => {
  test('volta 400, nao 500', () => {
    // Com 500 o PDV entra em retry por um dado que nunca se corrige sozinho — no
    // balcao isso vira fila enquanto o mesmo cupom e reenviado.
    expect(corpoDoCupom).toMatch(/err instanceof ErroDeDados \? 400 : 500/);
  });
});
