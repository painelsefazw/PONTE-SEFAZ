import * as zlib from 'zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { carimbarPdf, carimboDoStatus } from '../../src/infrastructure/pdf/CarimboPdf';

/**
 * Nota cancelada tem de sair carimbada no PDF.
 *
 * O defeito era discreto e caro: a interface mostrava CANCELADA, e o DANFE
 * baixado saía IDÊNTICO ao de uma nota válida. Um documento cancelado circulando
 * com cara de bom é pior que documento nenhum — ele é aceito por quem recebe.
 *
 * O carimbo é aplicado sobre o PDF já pronto, e não desenhado durante a geração,
 * porque o DANFE oficial vem de um serviço externo: só temos os bytes dele. Por
 * isso os testes abaixo conferem o RESULTADO — que o texto está no PDF de saída
 * — em vez de conferir que alguma função foi chamada.
 */

/** Um PDF de verdade para carimbar, com o número de páginas pedido. */
async function pdfDeTeste(paginas = 1, largura = 595, altura = 842): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < paginas; i++) {
    const p = doc.addPage([largura, altura]);
    p.drawText(`DANFE pagina ${i + 1}`, { x: 40, y: altura - 60, size: 12, font: fonte, color: rgb(0, 0, 0) });
  }
  return Buffer.from(await doc.save());
}

/**
 * Quantas vezes o texto aparece no PDF, olhando o ARQUIVO DE SAÍDA.
 *
 * Os content streams saem comprimidos (FlateDecode), então procurar a string
 * nos bytes crus não acha nada — foi o que a primeira versão deste teste fez, e
 * ela reprovava código que funcionava. Aqui cada stream é inflado e a busca
 * acontece no conteúdo real.
 *
 * A checagem é deliberadamente sobre o resultado, e não sobre "a função foi
 * chamada": o que importa é que o PDF entregue ao cliente tem a marca.
 */
function ocorrencias(pdf: Buffer, texto: string): number {
  // Duas armadilhas encontradas escrevendo este teste, cada uma capaz de fazer
  // ele reprovar código que funciona:
  //
  //  1. Os content streams saem comprimidos (FlateDecode) — procurar nos bytes
  //     crus não acha nada.
  //  2. O texto não vai como string legível: o pdf-lib escreve em HEXADECIMAL,
  //     `<43414E43454C414441> Tj`. Procurar "CANCELADA" no stream inflado
  //     também não acha.
  const alvos = [texto, Buffer.from(texto, 'latin1').toString('hex').toUpperCase()];
  const contar = (onde: string) =>
    alvos.reduce((n, alvo) => n + onde.split(alvo).length - 1, 0);

  const cru = pdf.toString('latin1');
  let total = contar(cru); // streams não comprimidos, se houver

  const re = /stream\r?\n?([\s\S]*?)endstream/g;
  for (let m = re.exec(cru); m; m = re.exec(cru)) {
    try {
      total += contar(zlib.inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1'));
    } catch { /* stream que não é FlateDecode: já contou no bruto */ }
  }
  return total;
}

describe('carimbo de cancelamento no PDF', () => {
  test('o texto CANCELADA entra no PDF', async () => {
    const original = await pdfDeTeste();
    expect(ocorrencias(original, 'CANCELADA')).toBe(0);

    const carimbado = await carimbarPdf(original, 'CANCELADA');
    expect(ocorrencias(carimbado, 'CANCELADA')).toBeGreaterThan(0);
  });

  test('carimba TODAS as paginas, nao so a primeira', async () => {
    // DANFE com muitos itens vira duas ou tres páginas. Carimbar só a primeira
    // deixa as outras circulando limpas.
    const carimbado = await carimbarPdf(await pdfDeTeste(3), 'CANCELADA');
    const doc = await PDFDocument.load(carimbado);
    expect(doc.getPageCount()).toBe(3);
    expect(ocorrencias(carimbado, 'CANCELADA')).toBeGreaterThanOrEqual(3);
  });

  test('o conteudo original continua la', async () => {
    // O carimbo cobre, não substitui: a nota cancelada continua sendo o
    // documento contábil daquela operação.
    const carimbado = await carimbarPdf(await pdfDeTeste(), 'CANCELADA');
    expect(ocorrencias(carimbado, 'DANFE pagina 1')).toBeGreaterThan(0);
  });

  test('cupom estreito nao quebra o carimbo', async () => {
    // NFC-e sai em bobina de 80mm (~227pt). Corpo fixo estouraria a largura.
    const carimbado = await carimbarPdf(await pdfDeTeste(1, 227, 800), 'CANCELADA');
    expect(ocorrencias(carimbado, 'CANCELADA')).toBeGreaterThan(0);
  });

  test('PDF ilegivel devolve o original em vez de derrubar o download', async () => {
    // Um DANFE sem carimbo é ruim; um download que volta 500 é pior — o
    // operador fica sem o documento e sem entender por quê.
    const lixo = Buffer.from('isto nao e um PDF');
    await expect(carimbarPdf(lixo, 'CANCELADA')).resolves.toEqual(lixo);
  });
});

describe('que status merece carimbo', () => {
  test.each([
    ['CANCELADA', 'CANCELADA'],
    ['cancelada', 'CANCELADA'],
    [' Cancelada ', 'CANCELADA'],
    ['DENEGADA', 'DENEGADA'],
  ])('%s -> %s', (status, esperado) => {
    expect(carimboDoStatus(status)).toBe(esperado);
  });

  test.each([['AUTORIZADA'], [''], [undefined]])('%s sai limpo', (status) => {
    // Carimbar "AUTORIZADA" numa nota válida sujaria o documento sem
    // acrescentar informação nenhuma.
    expect(carimboDoStatus(status as string | undefined)).toBeUndefined();
  });
});
