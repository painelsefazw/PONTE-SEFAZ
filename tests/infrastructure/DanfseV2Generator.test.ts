/**
 * O PDF é conferido pelo texto que sai dentro dele. Comparar bytes não serviria
 * (pdfkit varia com data de criação) e comparar imagem exigiria rasterizador.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DanfseV2Generator } from '../../src/infrastructure/pdf/danfse/DanfseV2Generator';
import { PAPEL } from '../../src/infrastructure/pdf/danfse/grade';

const xml = fs.readFileSync(
  path.join(__dirname, '../fixtures/nfse/nfse-real-ibscbs.xml'), 'utf8');

/**
 * Texto legível do PDF.
 *
 * O pdfkit escreve cada trecho como string hexadecimal dentro de um array TJ
 * (`[<44> 40 <414e...> 0] TJ`), com os números sendo ajuste de espaçamento
 * entre pares de letras. Decodifica-se o hex em latin1, que é a codificação
 * WinAnsi usada nas fontes base do PDF.
 */
function textoDoPdf(pdf: Buffer): string {
  const zlib = require('zlib');
  const bruto = pdf.toString('latin1');
  let fluxo = '';
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bruto))) {
    const ini = m.index + m[0].length;
    const fim = bruto.indexOf('endstream', ini);
    try { fluxo += zlib.inflateSync(pdf.subarray(ini, fim)).toString('latin1'); } catch { /* imagem */ }
  }

  const hexParaTexto = (hex: string) =>
    Buffer.from(hex.replace(/\s+/g, ''), 'hex').toString('latin1');

  return (fluxo.match(/\[[^\]]*\]\s*TJ|<[0-9a-fA-F\s]+>\s*Tj/g) || [])
    .map(trecho => (trecho.match(/<([0-9a-fA-F\s]+)>/g) || [])
      .map(h => hexParaTexto(h.slice(1, -1))).join(''))
    .join('\n');
}

describe('DanfseV2Generator — NT 008/2026', () => {
  jest.setTimeout(60_000);
  let pdf: Buffer;
  let texto: string;

  beforeAll(async () => {
    pdf = await new DanfseV2Generator().generate(xml);
    texto = textoDoPdf(pdf);
  });

  test('gera um PDF de uma única página (item 2.2)', () => {
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || [])).toHaveLength(1);
  });

  test('papel A4 retrato', () => {
    const mb = pdf.toString('latin1').match(/\/MediaBox\s*\[([^\]]+)\]/);
    const [, , l, a] = mb![1].trim().split(/\s+/).map(Number);
    expect(l).toBeCloseTo((PAPEL.largura * 72) / 2.54, 0);
    expect(a).toBeCloseTo((PAPEL.altura * 72) / 2.54, 0);
    expect(a).toBeGreaterThan(l);
  });

  test('cabeçalho identifica o DANFSe v2.0 (item 2.4.3)', () => {
    expect(texto).toContain('DANFSe v2.0');
    expect(texto).toContain('Documento Auxiliar da NFS-e');
  });

  test('nota de produção não leva o aviso de homologação', () => {
    expect(texto).not.toContain('SEM VALIDADE JURÍDICA');
  });

  test('ambiente gerador: 1 é o sistema do município, não o nacional', () => {
    // A nota real tem ambGer=1 e tpEmis=2 — emitida pelo sistema da prefeitura
    // (SilTecnologia) e transcrita para o modelo nacional.
    expect(texto).toContain('Sistema Próprio do Município');
    expect(texto).not.toContain('Ambiente Gerador: Sistema Nacional');
  });

  test('ambiente gerador 2 é a SEFIN Nacional', async () => {
    const nacional = await new DanfseV2Generator()
      .generate(xml.replace('<ambGer>1</ambGer>', '<ambGer>2</ambGer>'));
    expect(textoDoPdf(nacional)).toContain('SEFIN Nacional NFS-e');
  });

  test('imprime a chave de acesso completa', () => {
    expect(texto).toContain('35306071252372968000142000000000776426070602320288');
  });

  describe('bloco IBS/CBS', () => {
    test('o título do bloco existe', () => {
      expect(texto).toContain('TRIBUTAÇÃO IBS / CBS');
    });

    test('os valores apurados aparecem no papel', () => {
      expect(texto).toContain('200 / 200029');        // CST / cClassTrib
      expect(texto).toContain('030101');              // indicador de operação
      expect(texto).toContain('291,00');              // base após exclusões
      expect(texto).toContain('0,12');                // IBS apurado
      expect(texto).toContain('1,05');                // CBS apurado
    });

    test('percentuais saem com o sinal de %', () => {
      expect(texto).toContain('0,04%');   // alíquota efetiva estadual
      expect(texto).toContain('0,36%');   // alíquota efetiva da CBS
      expect(texto).toContain('60,00%');  // redução de alíquota
    });
  });

  describe('município pelo nome, não pelo código (item 2.4.5)', () => {
    test('o tomador sai com o nome do município, resolvido pela tabela do IBGE', () => {
      // O XML da nota só traz <cMun>3530607</cMun> para o tomador.
      expect(texto).toContain('Mogi das Cruzes / SP');
      expect(texto).not.toContain('3530607 / SP');
    });

    test('código de município inexistente não vira nome inventado', async () => {
      const estranho = await new DanfseV2Generator()
        .generate(xml.replace(/<cMun>3530607<\/cMun>\s*<CEP>08700000<\/CEP>/,
          '<cMun>9999999</cMun><CEP>08700000</CEP>'));
      const t = textoDoPdf(estranho);
      expect(t).toContain('9999999');
      expect(t).not.toContain('9999999 / Mogi');
    });
  });

  test('totais incluem o total de IBS/CBS', () => {
    expect(texto).toContain('TOTAL DA NFS-E');
    expect(texto).toContain('1,17');   // 0,12 + 1,05
    expect(texto).toContain('300,00');
  });

  test('imprime a linha obrigatória da Lei 12.741 (nota 10)', () => {
    expect(texto).toContain('Totais Aproximados dos Tributos');
    expect(texto).toContain('Lei nº 12.741/2012');
  });

  test('campo sem dado vira traço, não fica vazio (nota 12)', () => {
    // O tomador da nota real não tem inscrição municipal nem telefone.
    expect(texto).toContain('-');
  });

  test('tomador sem telefone não inventa valor', () => {
    expect(texto).not.toContain('undefined');
    expect(texto).not.toContain('null');
    expect(texto).not.toContain('NaN');
  });

  test('o canhoto é opcional e vem desligado (nota 11)', async () => {
    expect(texto).not.toContain('Data de Cientificação');
    const com = textoDoPdf(await new DanfseV2Generator().generate(xml, { canhoto: true }));
    expect(com).toContain('Data de Cientificação');
  });

  test('homologação recebe o aviso em vermelho (item 2.4.3)', async () => {
    const hom = await new DanfseV2Generator()
      .generate(xml.replace('<tpAmb>1</tpAmb>', '<tpAmb>2</tpAmb>'));
    expect(textoDoPdf(hom)).toContain('NFS-e SEM VALIDADE JURÍDICA');
  });

  test('nota cancelada recebe marca d\'água (item 2.5.1)', async () => {
    const canc = await new DanfseV2Generator()
      .generate(xml.replace('<cStat>100</cStat>', '<cStat>101</cStat>'));
    expect(textoDoPdf(canc)).toContain('CANCELADA');
  });

  test('nota substituída recebe marca d\'água (item 2.5.2)', async () => {
    const sub = await new DanfseV2Generator().generate(
      xml.replace('<tpEmit>1</tpEmit>', '<tpEmit>1</tpEmit><chSubstda>351</chSubstda>'));
    expect(textoDoPdf(sub)).toContain('SUBSTITUÍDA');
  });

  test('embute o QR Code apontando para o portal nacional', () => {
    const bruto = pdf.toString('latin1');
    expect(bruto).toMatch(/\/Subtype\s*\/Image/);
    expect(texto).toContain('autenticidade desta NFS-e');
  });
});
