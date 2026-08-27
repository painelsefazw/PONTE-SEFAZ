import PDFDocument from 'pdfkit';
import { NFe } from '../../domain/models';

export interface DanfeInput {
  nfe: NFe;
  chaveAcesso: string;
  nProt: string;
  dhRecbto: string;
}

export class DanfeGenerator {
  generate(input: DanfeInput): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const { nfe, chaveAcesso, nProt, dhRecbto } = input;
      const doc = new PDFDocument({ size: 'A4', margin: 30 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

    const W = 535;
    let y = 30;

    doc.rect(30, y, W, 80).stroke();
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('DANFE', 40, y + 5, { width: W - 20, align: 'center' });
    doc.fontSize(8).font('Helvetica');
    doc.text('Documento Auxiliar da Nota Fiscal Eletronica', 40, y + 22, { width: W - 20, align: 'center' });
    doc.text(`0 - ENTRADA    1 - SAIDA`, 40, y + 34, { width: W - 20, align: 'center' });
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text(`Nro: ${nfe.ide.nNF}`, 440, y + 5);
    doc.text(`Serie: ${nfe.ide.serie}`, 440, y + 18);
    doc.fontSize(8).font('Helvetica');
    doc.text(`Tipo: ${nfe.ide.tpNF === '1' ? 'SAIDA' : 'ENTRADA'}`, 440, y + 34);
    y += 85;

    doc.rect(30, y, W, 22).stroke();
    doc.fontSize(7).font('Helvetica');
    doc.text('CHAVE DE ACESSO', 35, y + 2);
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(this.formatChave(chaveAcesso), 35, y + 10, { characterSpacing: 1 });
    y += 27;

    doc.rect(30, y, W, 22).stroke();
    doc.fontSize(7).font('Helvetica');
    doc.text('PROTOCOLO DE AUTORIZACAO DE USO', 35, y + 2);
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(`${nProt} - ${this.formatDate(dhRecbto)}`, 35, y + 10);
    y += 27;

    doc.rect(30, y, W, 14).fillAndStroke('#e0e0e0', '#000');
    doc.fillColor('#000').fontSize(8).font('Helvetica-Bold');
    doc.text('EMITENTE', 35, y + 3);
    y += 18;

    y = this.addField(doc, 35, y, W - 10, 'NOME/RAZAO SOCIAL', nfe.emit.xNome);
    y = this.addFieldRow(doc, 35, y, [
      { label: 'CNPJ', value: this.formatCnpj(nfe.emit.CNPJ || ''), width: 180 },
      { label: 'IE', value: nfe.emit.IE, width: 150 },
      { label: 'CRT', value: nfe.emit.CRT, width: 60 },
    ]);
    y = this.addField(doc, 35, y, W - 10, 'ENDERECO',
      `${nfe.emit.enderEmit.xLgr}, ${nfe.emit.enderEmit.nro} - ${nfe.emit.enderEmit.xBairro} - ${nfe.emit.enderEmit.xMun}/${nfe.emit.enderEmit.UF} - CEP: ${nfe.emit.enderEmit.CEP}`);
    y += 5;

    doc.rect(30, y, W, 14).fillAndStroke('#e0e0e0', '#000');
    doc.fillColor('#000').fontSize(8).font('Helvetica-Bold');
    doc.text('DESTINATARIO', 35, y + 3);
    y += 18;

    y = this.addField(doc, 35, y, W - 10, 'NOME/RAZAO SOCIAL', nfe.dest.xNome);
    y = this.addFieldRow(doc, 35, y, [
      { label: 'CNPJ/CPF', value: this.formatCnpj(nfe.dest.CNPJ || nfe.dest.CPF || ''), width: 180 },
      { label: 'IE', value: nfe.dest.IE || '', width: 150 },
      { label: 'IND IE DEST', value: nfe.dest.indIEDest, width: 80 },
    ]);
    y = this.addField(doc, 35, y, W - 10, 'ENDERECO',
      `${nfe.dest.enderDest.xLgr}, ${nfe.dest.enderDest.nro} - ${nfe.dest.enderDest.xBairro} - ${nfe.dest.enderDest.xMun}/${nfe.dest.enderDest.UF}`);
    y += 5;

    doc.rect(30, y, W, 14).fillAndStroke('#e0e0e0', '#000');
    doc.fillColor('#000').fontSize(8).font('Helvetica-Bold');
    doc.text('PRODUTOS / SERVICOS', 35, y + 3);
    y += 18;

    const cols = [
      { label: 'CODIGO', width: 60 },
      { label: 'DESCRICAO', width: 180 },
      { label: 'NCM', width: 65 },
      { label: 'CFOP', width: 40 },
      { label: 'UN', width: 30 },
      { label: 'QTD', width: 50 },
      { label: 'V.UNIT', width: 55 },
      { label: 'V.TOTAL', width: 55 },
    ];

    doc.rect(30, y, W, 12).fillAndStroke('#f0f0f0', '#000');
    doc.fillColor('#000').fontSize(6).font('Helvetica-Bold');
    let cx = 35;
    for (const col of cols) {
      doc.text(col.label, cx, y + 3, { width: col.width });
      cx += col.width;
    }
    y += 14;

    doc.font('Helvetica').fontSize(7);
    for (const item of nfe.det) {
      if (y > 700) {
        doc.addPage();
        y = 30;
      }
      cx = 35;
      doc.text(item.prod.cProd, cx, y, { width: cols[0].width }); cx += cols[0].width;
      doc.text(item.prod.xProd, cx, y, { width: cols[1].width }); cx += cols[1].width;
      doc.text(item.prod.NCM, cx, y, { width: cols[2].width }); cx += cols[2].width;
      doc.text(item.prod.CFOP, cx, y, { width: cols[3].width }); cx += cols[3].width;
      doc.text(item.prod.uCom, cx, y, { width: cols[4].width }); cx += cols[4].width;
      doc.text(item.prod.qCom, cx, y, { width: cols[5].width, align: 'right' }); cx += cols[5].width;
      doc.text(item.prod.vUnCom, cx, y, { width: cols[6].width, align: 'right' }); cx += cols[6].width;
      doc.text(item.prod.vProd, cx, y, { width: cols[7].width, align: 'right' });
      y += 12;
    }
    y += 5;

    doc.rect(30, y, W, 14).fillAndStroke('#e0e0e0', '#000');
    doc.fillColor('#000').fontSize(8).font('Helvetica-Bold');
    doc.text('TOTAIS', 35, y + 3);
    y += 18;

    y = this.addFieldRow(doc, 35, y, [
      { label: 'BASE ICMS', value: nfe.total.ICMSTot.vBC, width: 80 },
      { label: 'ICMS', value: nfe.total.ICMSTot.vICMS, width: 70 },
      { label: 'V.PROD', value: nfe.total.ICMSTot.vProd, width: 80 },
      { label: 'FRETE', value: nfe.total.ICMSTot.vFrete, width: 70 },
      { label: 'DESC', value: nfe.total.ICMSTot.vDesc, width: 70 },
      { label: 'TOTAL NF', value: nfe.total.ICMSTot.vNF, width: 90 },
    ]);
    y += 5;

    if (nfe.infAdic) {
      doc.rect(30, y, W, 14).fillAndStroke('#e0e0e0', '#000');
      doc.fillColor('#000').fontSize(8).font('Helvetica-Bold');
      doc.text('INFORMACOES ADICIONAIS', 35, y + 3);
      y += 18;

      if (nfe.infAdic.infCpl) {
        doc.fontSize(7).font('Helvetica');
        doc.text(nfe.infAdic.infCpl, 35, y, { width: W - 10 });
        y += doc.heightOfString(nfe.infAdic.infCpl, { width: W - 10 }) + 5;
      }
    }

    doc.end();
    });
  }

  private formatChave(chave: string): string {
    return chave.replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  private formatCnpj(cnpj: string): string {
    if (cnpj.length === 14) {
      return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    if (cnpj.length === 11) {
      return cnpj.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }
    return cnpj;
  }

  private formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch {
      return iso;
    }
  }

  private addField(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string, value: string): number {
    doc.fontSize(6).font('Helvetica').text(label, x, y);
    doc.fontSize(8).font('Helvetica-Bold').text(value, x, y + 8, { width });
    return y + 22;
  }

  private addFieldRow(doc: PDFKit.PDFDocument, x: number, y: number, fields: { label: string; value: string; width: number }[]): number {
    let cx = x;
    for (const f of fields) {
      doc.fontSize(6).font('Helvetica').text(f.label, cx, y);
      doc.fontSize(8).font('Helvetica-Bold').text(f.value, cx, y + 8, { width: f.width });
      cx += f.width;
    }
    return y + 22;
  }
}
