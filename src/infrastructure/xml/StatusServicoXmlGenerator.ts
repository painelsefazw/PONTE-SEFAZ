import { create } from 'xmlbuilder2';

export class StatusServicoXmlGenerator {
  generate(tpAmb: string, cUF: string): string {
    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('consStatServ', {
        xmlns: 'http://www.portalfiscal.inf.br/nfe',
        versao: '4.00',
      })
        .ele('tpAmb').txt(tpAmb).up()
        .ele('cUF').txt(cUF).up()
        .ele('xServ').txt('STATUS').up()
      .up();

    return doc.end({ headless: true });
  }
}
