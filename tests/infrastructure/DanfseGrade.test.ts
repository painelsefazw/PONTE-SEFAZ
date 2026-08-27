/**
 * A grade é conferida geometricamente, não por inspeção visual.
 *
 * A primeira versão do DANFSe saiu com campos sobrepostos porque eu derivei as
 * linhas por soma (sup + 0,64) em vez de copiar a coordenada da NT, e porque
 * desenhei os títulos de bloco como faixa acima do bloco. Nada disso quebra
 * teste de conteúdo — o texto está lá, só que por baixo de outra caixa. Estes
 * testes cobrem a geometria, que é onde o erro mora.
 */
import {
  CAMPOS_IDENT, CAMPOS_PRESTADOR, CAMPOS_TOMADOR, CAMPOS_DESTINATARIO,
  CAMPOS_INTERMEDIARIO, CAMPOS_SERVICO, CAMPOS_ISSQN, CAMPOS_FEDERAL,
  CAMPOS_IBSCBS, CAMPOS_TOTAIS, CAMPOS_CANHOTO, BLOCOS, QRCODE, PAPEL, COL,
  type Campo,
} from '../../src/infrastructure/pdf/danfse/grade';

const TODOS: Array<[string, Campo[]]> = [
  ['identificação', CAMPOS_IDENT],
  ['prestador', CAMPOS_PRESTADOR],
  ['tomador', CAMPOS_TOMADOR],
  ['destinatário', CAMPOS_DESTINATARIO],
  ['intermediário', CAMPOS_INTERMEDIARIO],
  ['serviço', CAMPOS_SERVICO],
  ['ISSQN', CAMPOS_ISSQN],
  ['federal', CAMPOS_FEDERAL],
  ['IBS/CBS', CAMPOS_IBSCBS],
  ['totais', CAMPOS_TOTAIS],
  ['canhoto', CAMPOS_CANHOTO],
];

const planos = TODOS.flatMap(([bloco, campos]) =>
  campos.map(c => ({ ...c, bloco })));

/** Duas caixas se cruzam? Toque de borda não conta. */
function cruza(a: Campo, b: Campo): boolean {
  const folga = 1e-9;
  return a.esq < b.esq + b.larg - folga && b.esq < a.esq + a.larg - folga
    && a.sup < b.sup + b.alt - folga && b.sup < a.sup + a.alt - folga;
}

describe('grade do DANFSe — geometria', () => {
  test('nenhum campo se sobrepõe a outro', () => {
    const colisoes: string[] = [];
    for (let i = 0; i < planos.length; i++) {
      for (let j = i + 1; j < planos.length; j++) {
        if (cruza(planos[i], planos[j])) {
          colisoes.push(
            `${planos[i].bloco}/"${planos[i].label}" (${planos[i].esq},${planos[i].sup}) x `
            + `${planos[j].bloco}/"${planos[j].label}" (${planos[j].esq},${planos[j].sup})`);
        }
      }
    }
    expect(colisoes).toEqual([]);
  });

  test('todo campo cabe dentro da margem do papel', () => {
    // A própria NT arredonda: as colunas avançam 5,11 / 5,10 / 5,11 cm mas cada
    // campo mede 5,09 de largura, então a quarta coluna termina em 20,71 contra
    // os 20,70 da área útil. Um centésimo de centímetro — 0,1 mm — é a precisão
    // do documento oficial, não folga inventada aqui.
    const ARREDONDAMENTO_NT = 0.01;
    const fora = planos.filter(c =>
      c.esq < PAPEL.margem - ARREDONDAMENTO_NT
      || c.esq + c.larg > PAPEL.largura - PAPEL.margem + ARREDONDAMENTO_NT
      || c.sup < PAPEL.margem - ARREDONDAMENTO_NT
      || c.sup + c.alt > PAPEL.altura - PAPEL.margem + ARREDONDAMENTO_NT);
    expect(fora.map(c => `${c.bloco}/${c.label}`)).toEqual([]);
  });

  test('todo campo começa numa das quatro colunas da NT', () => {
    const colunas: number[] = [COL.c1, COL.c2, COL.c3, COL.c4];
    const foraDaColuna = planos.filter(c => !colunas.some(x => Math.abs(x - c.esq) < 1e-9));
    expect(foraDaColuna.map(c => `${c.bloco}/${c.label}@${c.esq}`)).toEqual([]);
  });

  test('nenhum campo passa da borda direita da última coluna', () => {
    const limite = COL.c4 + 5.09;
    expect(planos.filter(c => c.esq + c.larg > limite + 0.01).map(c => c.label)).toEqual([]);
  });

  test('o QR Code não invade o bloco de identificação', () => {
    const qr: Campo = { label: 'qr', alt: QRCODE.lado, larg: QRCODE.lado, esq: QRCODE.esq, sup: QRCODE.sup };
    // A chave de acesso ocupa 15,30 cm e termina antes do QR Code.
    const chave = CAMPOS_IDENT[0];
    expect(chave.esq + chave.larg).toBeLessThanOrEqual(QRCODE.esq);
    expect(cruza(qr, chave)).toBe(false);
  });

  test('as informações complementares não invadem o canhoto', () => {
    expect(BLOCOS.infoComplTexto.sup).toBeLessThan(BLOCOS.canhoto.sup);
    expect(CAMPOS_TOTAIS.every(c => c.sup + c.alt <= BLOCOS.infoCompl.sup + 1e-9)).toBe(true);
  });

  test('cada bloco tem exatamente um título, na coluna 1', () => {
    for (const [nome, campos] of TODOS) {
      const titulos = campos.filter(c => c.titulo);
      if (nome === 'identificação' || nome === 'canhoto') {
        expect(titulos).toHaveLength(0);   // caixa envolvente, sem célula-título
        continue;
      }
      expect(`${nome}: ${titulos.length}`).toBe(`${nome}: 1`);
      expect(titulos[0].esq).toBe(COL.c1);
      // O título divide a linha com o primeiro campo do bloco.
      expect(campos.some(c => !c.titulo && c.sup === titulos[0].sup)).toBe(true);
    }
  });

  test('os blocos aparecem na ordem da NT, de cima para baixo', () => {
    const inicios = TODOS.map(([nome, campos]) =>
      [nome, Math.min(...campos.map(c => c.sup))] as const);
    const ordenado = [...inicios].sort((a, b) => a[1] - b[1]);
    expect(inicios.map(i => i[0])).toEqual(ordenado.map(i => i[0]));
  });

  test('o bloco IBS/CBS tem os quatorze campos do item 2.1.10', () => {
    expect(CAMPOS_IBSCBS.filter(c => !c.titulo)).toHaveLength(14);
  });
});
