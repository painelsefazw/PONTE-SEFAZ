import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

/**
 * Carimbo diagonal sobre um PDF JÁ PRONTO.
 *
 * Por que carimbar depois em vez de desenhar durante a geração: o DANFE oficial
 * não é gerado aqui. Quando `DANFE_SERVICE_URL` está configurado — e está, em
 * produção — o PDF vem pronto de um serviço PHP externo, e a única coisa que
 * temos dele são os bytes. Desenhar só no gerador local deixaria justamente o
 * DANFE oficial, que é o que a maioria baixa, sem marca nenhuma.
 *
 * Carimbando o resultado, os dois caminhos ficam cobertos por um código só, e o
 * layout oficial é preservado.
 *
 * `pdfkit` (usado pelo gerador local) escreve PDF e não lê; por isso aqui é
 * `pdf-lib`, que abre o documento existente.
 */

/** Cinza médio: legível sobre o branco, sem apagar o texto que está embaixo. */
const CINZA = rgb(0.65, 0.65, 0.65);

/**
 * Escreve o texto na diagonal, em TODAS as páginas.
 *
 * Falha nunca derruba o download: um DANFE sem carimbo é ruim, um download que
 * volta 500 é pior — o operador fica sem o documento e sem entender por quê. Em
 * caso de erro, devolve o PDF original.
 */
export async function carimbarPdf(pdf: Buffer, texto: string): Promise<Buffer> {
  try {
    const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
    const fonte = await doc.embedFont(StandardFonts.HelveticaBold);

    for (const pagina of doc.getPages()) {
      const { width, height } = pagina.getSize();

      // O tamanho sai da largura da página: DANFE em A4 retrato e cupom em
      // bobina de 80mm são documentos de escala muito diferente, e um corpo
      // fixo ou estouraria a bobina ou sumiria no A4.
      const corpo = Math.max(18, Math.min(64, width / (texto.length * 0.62)));
      const larguraTexto = fonte.widthOfTextAtSize(texto, corpo);

      // A -45° o texto anda para a direita e para cima conforme avança; o
      // deslocamento abaixo o traz de volta ao centro geométrico da página.
      const rad = Math.PI / 4;
      pagina.drawText(texto, {
        x: width / 2 - (larguraTexto / 2) * Math.cos(rad),
        y: height / 2 - (larguraTexto / 2) * Math.sin(rad) - corpo / 2,
        size: corpo,
        font: fonte,
        color: CINZA,
        rotate: degrees(45),
        // Translúcido de propósito: o carimbo precisa ser inequívoco sem
        // impedir a leitura dos valores da nota, que continuam sendo o
        // documento contábil daquela operação.
        opacity: 0.38,
      });
    }

    return Buffer.from(await doc.save());
  } catch {
    return pdf;
  }
}

/** O texto do carimbo para um status de nota, ou nada quando não cabe carimbo. */
export function carimboDoStatus(status: string | undefined): string | undefined {
  const s = String(status ?? '').trim().toUpperCase();
  if (s === 'CANCELADA') return 'CANCELADA';
  if (s === 'DENEGADA') return 'DENEGADA';
  // AUTORIZADA e o resto saem limpos. Carimbar "AUTORIZADA" numa nota válida
  // sujaria o documento sem acrescentar informação.
  return undefined;
}
