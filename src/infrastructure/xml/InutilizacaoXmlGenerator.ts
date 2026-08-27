import { create } from 'xmlbuilder2';

export interface InutilizacaoInput {
  tpAmb: string;
  cUF: string;
  ano: string;
  cnpj: string;
  mod: string;
  serie: string;
  nNFIni: string;
  nNFFin: string;
  xJust: string;
}

export class InutilizacaoXmlGenerator {
  generate(input: InutilizacaoInput): string {
    const id = `ID${input.cUF}${input.ano}${input.cnpj}${input.mod}${input.serie.padStart(3, '0')}${input.nNFIni.padStart(9, '0')}${input.nNFFin.padStart(9, '0')}`;

    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('inutNFe', {
        xmlns: 'http://www.portalfiscal.inf.br/nfe',
        versao: '4.00',
      })
        .ele('infInut', { Id: id })
          .ele('tpAmb').txt(input.tpAmb).up()
          .ele('xServ').txt('INUTILIZAR').up()
          .ele('cUF').txt(input.cUF).up()
          .ele('ano').txt(input.ano).up()
          .ele('CNPJ').txt(input.cnpj).up()
          .ele('mod').txt(input.mod).up()
          .ele('serie').txt(input.serie).up()
          .ele('nNFIni').txt(input.nNFIni).up()
          .ele('nNFFin').txt(input.nNFFin).up()
          .ele('xJust').txt(input.xJust).up()
        .up()
      .up();

    return doc.end({ headless: true });
  }
}
