import { create } from 'xmlbuilder2';

const NS = 'http://www.portalfiscal.inf.br/nfe';

export class ConsultaXmlGenerator {
  generate(chaveAcesso: string, ambiente: string): string {
    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele(NS, 'consSitNFe')
      .att('versao', '4.00')
      .ele(NS, 'tpAmb').txt(ambiente).up()
      .ele(NS, 'xServ').txt('CONSULTAR').up()
      .ele(NS, 'chNFe').txt(chaveAcesso).up()
      .up();

    return doc.end({ prettyPrint: false });
  }
}
