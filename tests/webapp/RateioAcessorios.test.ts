import { ratearAcessorios } from '../../src/webapp/app';

/**
 * Rateio de desconto, frete, seguro e despesas pelos itens.
 *
 * A versao anterior dava ao ULTIMO item toda a sobra (total - distribuido) em
 * vez do proprio quinhao. Quando os itens anteriores arredondam para cima, a
 * sobra fica NEGATIVA: quatro itens (tres de R$ 1,00 e um de R$ 0,01) com
 * desconto de R$ 0,02 produziam ['0.01','0.01','0.01','-0.01'], e o XML saia com
 * <vDesc>-0.01</vDesc>.
 *
 * O schema recusa o sinal, entao a previa reprovava — mas com um erro de facet
 * que nao tem como ser ligado a um rateio de dois centavos.
 *
 * A regra que substituiu: cada item leva o quinhao truncado e os centavos que
 * sobram vao um a um para quem tem o maior resto. Duas propriedades que o teste
 * cobre em todo caso: nenhuma parte negativa, e a soma fecha exata.
 */

const item = (q: string, v: string) => ({ quantidade: q, valorUnitario: v });

const soma = (itens: any[], campo: string) =>
  itens.reduce((a, it) => a + Number(it[campo] ?? '0'), 0);

describe('o caso que produzia centavo negativo', () => {
  const itens = [item('1', '1.00'), item('1', '1.00'), item('1', '1.00'), item('1', '0.01')];

  test('nenhuma parte fica negativa', () => {
    const r = ratearAcessorios(itens, { desconto: '0.02' });
    for (const it of r) expect(Number(it.desconto)).toBeGreaterThanOrEqual(0);
  });

  test('e a soma continua fechando com o total', () => {
    // Perder um centavo aqui desloca o vNF, que e o numero que o cliente paga.
    const r = ratearAcessorios(itens, { desconto: '0.02' });
    expect(soma(r, 'desconto')).toBeCloseTo(0.02, 10);
  });
});

describe('as duas propriedades valem em qualquer combinacao', () => {
  const casos: Array<[string, string[], string]> = [
    ['dois itens iguais, um centavo', ['1.00', '1.00'], '0.01'],
    ['tres itens iguais, um centavo', ['1.00', '1.00', '1.00'], '0.01'],
    ['tres itens iguais, dois centavos', ['1.00', '1.00', '1.00'], '0.02'],
    ['item minusculo no fim', ['1.00', '1.00', '1.00', '0.01'], '0.02'],
    ['item minusculo no comeco', ['0.01', '1.00', '1.00', '1.00'], '0.02'],
    ['sete itens, terco inexato', ['3.00', '3.00', '3.00', '3.00', '3.00', '3.00', '3.00'], '10.00'],
    ['valores desiguais', ['0.03', '99.97', '1.11'], '7.77'],
    ['total maior que os itens', ['1.00', '1.00'], '1000.00'],
  ];

  test.each(casos)('%s', (_nome, valores, total) => {
    const itens = valores.map(v => item('1', v));
    const r = ratearAcessorios(itens, { frete: total });
    for (const it of r) expect(Number(it.frete)).toBeGreaterThanOrEqual(0);
    expect(soma(r, 'frete')).toBeCloseTo(Number(total), 10);
  });
});

describe('o que ja funcionava continua', () => {
  test('rateio proporcional ao valor do item', () => {
    // 100 e 300 dividem 40 na proporcao 1:3.
    const r = ratearAcessorios([item('1', '100.00'), item('1', '300.00')], { frete: '40.00' });
    expect(r[0].frete).toBe('10.00');
    expect(r[1].frete).toBe('30.00');
  });

  test('valor por item informado pelo integrador SOMA ao rateio', () => {
    const itens = [{ ...item('1', '100.00'), frete: '5.00' }, item('1', '100.00')];
    const r = ratearAcessorios(itens, { frete: '10.00' });
    expect(r[0].frete).toBe('10.00'); // 5,00 dele + 5,00 do rateio
    expect(r[1].frete).toBe('5.00');
  });

  test('os quatro campos sao rateados', () => {
    const r = ratearAcessorios([item('1', '100.00'), item('1', '100.00')], {
      desconto: '10.00', frete: '20.00', seguro: '30.00', despesas: '40.00',
    });
    expect(r[0]).toMatchObject({ desconto: '5.00', frete: '10.00', seguro: '15.00', despesas: '20.00' });
  });

  test('sem acessorio nenhum, os itens voltam intactos', () => {
    const itens = [item('1', '100.00')];
    expect(ratearAcessorios(itens, {})).toBe(itens);
  });

  test('itens que somam zero nao entram na divisao', () => {
    // Dividir por zero produziria NaN em todo item.
    const itens = [item('0', '0.00')];
    expect(ratearAcessorios(itens, { frete: '10.00' })).toBe(itens);
  });

  test('o objeto original nao e alterado', () => {
    const itens = [item('1', '100.00'), item('1', '100.00')];
    ratearAcessorios(itens, { frete: '10.00' });
    expect((itens[0] as any).frete).toBeUndefined();
  });
});
