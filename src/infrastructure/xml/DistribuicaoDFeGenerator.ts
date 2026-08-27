import { create } from 'xmlbuilder2';

const NS_DIST = 'http://www.portalfiscal.inf.br/nfe';

export class DistribuicaoDFeGenerator {
  /**
   * Gera XML de consulta NFeDistribuicaoDFe por NSU ou último NSU.
   * @param cUFAutor - código IBGE da UF do autor (empresa)
   * @param cnpj - CNPJ da empresa
   * @param ultNSU - último NSU consultado (para buscar novos)
   * @param nsu - NSU específico (para buscar um documento)
   */
  generate(cUFAutor: string, cnpj: string, ultNSU?: string, nsu?: string): string {
    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele(NS_DIST, 'distDFeInt')
      .att('versao', '1.01');

    doc.ele('tpAmb').txt('1').up();
    doc.ele('cUFAutor').txt(cUFAutor).up();
    doc.ele('CNPJ').txt(cnpj).up();

    if (nsu) {
      doc.ele('consNSU').ele('NSU').txt(nsu.padStart(15, '0')).up().up();
    } else {
      doc.ele('distNSU').ele('ultNSU').txt((ultNSU || '0').padStart(15, '0')).up().up();
    }

    doc.up();
    return doc.end({ prettyPrint: false });
  }
}
