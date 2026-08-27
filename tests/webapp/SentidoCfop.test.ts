import { corrigirSentidoCfop } from '../../src/webapp/app';

/**
 * O sentido do CFOP não é escolha de quem integra.
 *
 * O CFOP guarda duas coisas: a natureza da operação, nos três últimos dígitos, e
 * o sentido com o destino, no primeiro. A natureza é decisão humana sobre o
 * produto. O primeiro dígito é consequência do que a nota é — entrada ou saída,
 * dentro do estado, fora dele ou no exterior — e o Emissor sabe as duas coisas
 * antes de montar o XML.
 *
 * Isto foi escrito depois de uma nota de entrada com CFOP 5102 ser recusada com
 * cStat 519. A prévia tinha dado verde: o XSD aceita 5102 numa entrada, quem
 * recusa é a regra de negócio da SEFAZ. Descobrir isso só na rejeição significa
 * ter montado, assinado e transmitido para nada.
 */

const item = (cfop: string, descricao = 'Produto') => ({ cfop, descricao, ncm: '84713012' });

describe('sentido do CFOP', () => {
  describe('nota de saida', () => {
    it('dentro do estado usa a faixa 5', () => {
      const r = corrigirSentidoCfop([item('1102')], { entrada: false, destino: '1' });
      expect(r.itens[0].cfop).toBe('5102');
    });

    it('para outro estado usa a faixa 6', () => {
      const r = corrigirSentidoCfop([item('5102')], { entrada: false, destino: '2' });
      expect(r.itens[0].cfop).toBe('6102');
    });

    it('para o exterior usa a faixa 7', () => {
      const r = corrigirSentidoCfop([item('5102')], { entrada: false, destino: '3' });
      expect(r.itens[0].cfop).toBe('7102');
    });
  });

  describe('nota de entrada', () => {
    it('o caso que gerou a rejeicao 519: 5102 numa entrada interna vira 1102', () => {
      const r = corrigirSentidoCfop([item('5102')], { entrada: true, destino: '1' });
      expect(r.itens[0].cfop).toBe('1102');
    });

    it('de outro estado usa a faixa 2', () => {
      const r = corrigirSentidoCfop([item('6102')], { entrada: true, destino: '2' });
      expect(r.itens[0].cfop).toBe('2102');
    });

    it('do exterior usa a faixa 3', () => {
      const r = corrigirSentidoCfop([item('5102')], { entrada: true, destino: '3' });
      expect(r.itens[0].cfop).toBe('3102');
    });
  });

  describe('a natureza da operacao e preservada', () => {
    it.each([
      ['5405', '1405', 'venda com ST retido'],
      ['5202', '1202', 'devolucao'],
      ['5915', '1915', 'remessa para conserto'],
      ['5949', '1949', 'outra saida nao especificada'],
      ['5152', '1152', 'transferencia'],
    ])('%s vira %s numa entrada interna (%s)', (de, para) => {
      const r = corrigirSentidoCfop([item(de)], { entrada: true, destino: '1' });
      expect(r.itens[0].cfop).toBe(para);
    });
  });

  describe('o que nao se mexe', () => {
    it('CFOP ja no sentido certo passa intacto, e sem registrar ajuste', () => {
      const original = item('5102');
      const r = corrigirSentidoCfop([original], { entrada: false, destino: '1' });
      expect(r.itens[0]).toBe(original);
      expect(r.ajustes).toHaveLength(0);
    });

    it('CFOP malformado nao e inventado — quem reclama e a validacao de schema', () => {
      for (const ruim of ['', '51', '510', '51022', 'abcd', undefined, null]) {
        const r = corrigirSentidoCfop([{ cfop: ruim }], { entrada: true, destino: '1' });
        expect(r.itens[0].cfop).toBe(ruim);
        expect(r.ajustes).toHaveLength(0);
      }
    });

    it('os demais campos do item ficam como estavam', () => {
      const r = corrigirSentidoCfop(
        [{ cfop: '5102', descricao: 'Boi', ncm: '01022190', quantidade: '10', cstIcms: '00' }],
        { entrada: true, destino: '1' },
      );
      expect(r.itens[0]).toEqual({
        cfop: '1102', descricao: 'Boi', ncm: '01022190', quantidade: '10', cstIcms: '00',
      });
    });

    it('lista vazia ou ausente nao quebra', () => {
      expect(corrigirSentidoCfop([], { entrada: true, destino: '1' }).itens).toEqual([]);
      expect(corrigirSentidoCfop(undefined as any, { entrada: true, destino: '1' }).itens).toEqual([]);
    });
  });

  describe('o ajuste e relatado, nunca silencioso', () => {
    it('diz qual item mudou, de que para que', () => {
      const r = corrigirSentidoCfop(
        [item('5102', 'Boi'), item('1102', 'Ja certo'), item('5405', 'Com ST')],
        { entrada: true, destino: '1' },
      );
      expect(r.ajustes).toEqual([
        { item: 1, de: '5102', para: '1102' },
        { item: 3, de: '5405', para: '1405' },
      ]);
    });

    it('a numeracao do ajuste e a posicao do item na nota, comecando em 1', () => {
      const r = corrigirSentidoCfop(
        [item('1102'), item('1102'), item('5102')],
        { entrada: true, destino: '1' },
      );
      expect(r.ajustes).toEqual([{ item: 3, de: '5102', para: '1102' }]);
    });
  });

  it('aplicar duas vezes nao muda mais nada', () => {
    const uma = corrigirSentidoCfop([item('5102')], { entrada: true, destino: '2' });
    const duas = corrigirSentidoCfop(uma.itens, { entrada: true, destino: '2' });
    expect(duas.itens[0].cfop).toBe('2102');
    expect(duas.ajustes).toHaveLength(0);
  });
});
