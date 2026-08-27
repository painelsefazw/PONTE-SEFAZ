import * as fs from 'fs';
import * as path from 'path';

/**
 * Campos de dominio fechado que decidiam coisas grandes sem serem conferidos.
 *
 * `tipoOperacao: "entrada"` e o mais natural de se mandar — e a rota de
 * classificacao ja tinha aprendido a aceitar. Mas o teste da emissao era
 * `String(body.tipoOperacao ?? '1') === '0'`, e 'entrada' nao e '0': a nota
 * virava SAIDA, os CFOPs 1102 que o ERP mandou certos eram reescritos para 5102,
 * e o texto 'entrada' ia inteiro para <tpNF>. A SEFAZ recusava por schema sem
 * dizer o campo, e a previa aprovava porque so conferia que a tag existe.
 *
 * `finalidade` e `destino` tinham o mesmo buraco: qualquer string atravessava a
 * montagem ate virar rejeicao.
 *
 * A funcao vive dentro do handler autenticado, entao o que da para provar sem
 * subir a rota e a TABELA — que e onde o defeito estaria.
 */

const fonte = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8',
);

const bloco = (() => {
  const i = fonte.indexOf('const DOMINIOS:');
  expect(i).toBeGreaterThan(-1);
  return fonte.slice(i, fonte.indexOf('function normalizarDominios'));
})();

describe('a tabela cobre os tres campos', () => {
  test.each(['tipoOperacao', 'finalidade', 'destino'])('%s esta na tabela', (campo) => {
    expect(bloco).toContain(`${campo}: {`);
  });
});

describe('os sinonimos que o integrador de fato manda', () => {
  test('"entrada" mapeia para 0, e nao para o default de saida', () => {
    // Era exatamente este valor que virava saida silenciosamente.
    expect(bloco).toMatch(/entrada:\s*'0'/);
  });

  test('"saida" e "venda" mapeiam para 1', () => {
    expect(bloco).toMatch(/saida:\s*'1'/);
    expect(bloco).toMatch(/venda:\s*'1'/);
  });

  test('"devolucao" existe nos dois campos onde significa coisas diferentes', () => {
    // Em tipoOperacao devolucao e ENTRADA (0); em finalidade e o codigo 4.
    // Um so mapeamento para os dois campos poria 4 no tpNF.
    expect(bloco).toMatch(/devolucao:\s*'0'/);
    expect(bloco).toMatch(/devolucao:\s*'4'/);
  });

  test('"interestadual" mapeia para 2 — e o que liga o DIFAL', () => {
    expect(bloco).toMatch(/interestadual:\s*'2'/);
  });
});

describe('os codigos validos sao os do leiaute', () => {
  test('tipoOperacao aceita so 0 e 1', () => {
    expect(bloco).toMatch(/tipoOperacao:\s*\{\s*\n?\s*validos:\s*\['0',\s*'1'\]/);
  });

  test('finalidade aceita de 1 a 4', () => {
    expect(bloco).toMatch(/validos:\s*\['1',\s*'2',\s*'3',\s*'4'\]/);
  });

  test('destino aceita de 1 a 3', () => {
    expect(bloco).toMatch(/validos:\s*\['1',\s*'2',\s*'3'\]/);
  });
});

describe('a recusa ensina em vez de so negar', () => {
  test('cada campo explica o que cada codigo significa', () => {
    expect(bloco).toMatch(/"0" = entrada \(compra\), "1" = saída \(venda\)/);
    expect(bloco).toMatch(/"4" = devolução/);
    expect(bloco).toMatch(/"2" = interestadual/);
  });

  test('a resposta devolve as duas listas — codigos e sinonimos', () => {
    // Quem recebe 400 precisa saber o que mandar. Devolver so "invalido"
    // obriga a caçar na documentacao.
    const fn = fonte.slice(fonte.indexOf('function normalizarDominios'));
    expect(fn).toMatch(/aceitos:\s*regra\.validos/);
    expect(fn).toMatch(/tambemAceitos:\s*Object\.keys\(regra\.sinonimos\)/);
  });
});

describe('a normalizacao acontece antes de a nota ser montada', () => {
  test('normalizarDominios e chamado antes do calculo de destino', () => {
    // Se rodar depois, o CFOP ja foi reescrito com o valor cru — que e o
    // defeito original, so que mais tarde.
    const chama = fonte.indexOf('normalizarDominios(body, res)');
    const calcula = fonte.indexOf('calcularDestino(emp.uf, ufDest)');
    expect(chama).toBeGreaterThan(-1);
    expect(calcula).toBeGreaterThan(chama);
  });
});
