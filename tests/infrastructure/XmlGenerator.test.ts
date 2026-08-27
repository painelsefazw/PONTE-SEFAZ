import { XmlGenerator } from '../../src/infrastructure/xml/XmlGenerator';
import {
  NFe,
  TipoAmbiente,
  TipoEmissao,
  FinalidadeNFe,
  IndicadorPresenca,
  OrigemMercadoria,
} from '../../src/domain/models';

/**
 * Creates a realistic NFe fixture for Simples Nacional (CRT 1, CSOSN 102).
 */
function createMockNFe(): NFe {
  return {
    ide: {
      cUF: '31',
      cNF: '00000001',
      natOp: 'VENDA DE MERCADORIA',
      mod: '55',
      serie: '1',
      nNF: '1',
      dhEmi: '2024-05-10T10:00:00-03:00',
      tpNF: '1',
      idDest: '1',
      cMunFG: '3106200',
      tpImp: '1',
      tpEmis: TipoEmissao.NORMAL,
      cDV: '0',
      tpAmb: TipoAmbiente.HOMOLOGACAO,
      finNFe: FinalidadeNFe.NORMAL,
      indFinal: '1',
      indPres: IndicadorPresenca.PRESENCIAL,
      procEmi: '0',
      verProc: '1.0.0',
    },
    emit: {
      CNPJ: '12345678000199',
      xNome: 'EMPRESA TESTE LTDA',
      xFant: 'TESTE',
      enderEmit: {
        xLgr: 'RUA TESTE',
        nro: '100',
        xBairro: 'CENTRO',
        cMun: '3106200',
        xMun: 'BELO HORIZONTE',
        UF: 'MG',
        CEP: '30130000',
        cPais: '1058',
        xPais: 'BRASIL',
        fone: '3132223333',
      },
      IE: '1234567890',
      CRT: '1',
    },
    dest: {
      CNPJ: '98765432000188',
      xNome: 'CLIENTE TESTE LTDA',
      enderDest: {
        xLgr: 'AV BRASIL',
        nro: '200',
        xBairro: 'SAVASSI',
        cMun: '3106200',
        xMun: 'BELO HORIZONTE',
        UF: 'MG',
        CEP: '30140071',
        cPais: '1058',
        xPais: 'BRASIL',
      },
      indIEDest: '1',
      IE: '0987654321',
      email: 'cliente@teste.com',
    },
    det: [
      {
        nItem: '1',
        prod: {
          cProd: '001',
          cEAN: 'SEM GTIN',
          xProd: 'NOTEBOOK',
          NCM: '84715010',
          CFOP: '5102',
          uCom: 'UN',
          qCom: '1.0000',
          vUnCom: '100.00',
          vProd: '100.00',
          cEANTrib: 'SEM GTIN',
          uTrib: 'UN',
          qTrib: '1.0000',
          vUnTrib: '100.00',
          indTot: '1',
        },
        imposto: {
          vTotTrib: '18.00',
          ICMS: {
            ICMSSN102: {
              orig: OrigemMercadoria.NACIONAL,
              CSOSN: '102',
            },
          },
          PIS: {
            PISOutr: {
              CST: '99',
            },
          },
          COFINS: {
            COFINSOutr: {
              CST: '99',
            },
          },
        },
      },
    ],
    total: {
      ICMSTot: {
        vBC: '0.00',
        vICMS: '0.00',
        vICMSDeson: '0.00',
        vFCP: '0.00',
        vBCST: '0.00',
        vST: '0.00',
        vFCPST: '0.00',
        vFCPSTRet: '0.00',
        vProd: '100.00',
        vFrete: '0.00',
        vSeg: '0.00',
        vDesc: '0.00',
        vII: '0.00',
        vIPI: '0.00',
        vIPIDevol: '0.00',
        vPIS: '0.00',
        vCOFINS: '0.00',
        vOutro: '0.00',
        vNF: '100.00',
      },
    },
    transp: {
      modFrete: '9',
    },
    pag: {
      detPag: [
        {
          tPag: '01',
          vPag: '100.00',
        },
      ],
    },
  };
}

describe('XmlGenerator', () => {
  let generator: XmlGenerator;

  beforeEach(() => {
    generator = new XmlGenerator();
  });

  describe('generateInfNFe', () => {
    it('should generate XML with correct namespace', () => {
      const nfe = createMockNFe();
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');

      expect(xml).toContain('xmlns="http://www.portalfiscal.inf.br/nfe"');
    });

    it('should contain infNFe with versao 4.00 and correct Id attribute', () => {
      const nfe = createMockNFe();
      const chave = '31240512345678000199550010000000011000000010';
      const xml = generator.generateInfNFe(nfe, chave);

      expect(xml).toContain(`<infNFe versao="4.00" Id="NFe${chave}"`);
    });

    it('should contain all required NF-e sections', () => {
      const nfe = createMockNFe();
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');

      expect(xml).toContain('<ide>');
      expect(xml).toContain('</ide>');
      expect(xml).toContain('<emit>');
      expect(xml).toContain('</emit>');
      expect(xml).toContain('<dest>');
      expect(xml).toContain('</dest>');
      expect(xml).toContain('<det ');
      expect(xml).toContain('</det>');
      expect(xml).toContain('<total>');
      expect(xml).toContain('</total>');
      expect(xml).toContain('<transp>');
      expect(xml).toContain('</transp>');
      expect(xml).toContain('<pag>');
      expect(xml).toContain('</pag>');
    });

    it('should omit optional fields when undefined', () => {
      const nfe = createMockNFe();
      // dhSaiEnt is not set in the mock
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');

      expect(xml).not.toContain('<dhSaiEnt>');
      expect(xml).not.toContain('<xCpl>');
    });

    it('should serialize ICMSSN102 correctly for Simples Nacional', () => {
      const nfe = createMockNFe();
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');

      expect(xml).toContain('<ICMSSN102>');
      expect(xml).toContain('<orig>0</orig>');
      expect(xml).toContain('<CSOSN>102</CSOSN>');
      expect(xml).toContain('</ICMSSN102>');
    });

    it('should serialize ICMS00 correctly for regime normal', () => {
      const nfe = createMockNFe();
      nfe.emit.CRT = '3';
      nfe.det[0].imposto.ICMS = {
        ICMS00: {
          orig: OrigemMercadoria.NACIONAL,
          CST: '00',
          modBC: '3',
          vBC: '100.00',
          pICMS: '18.00',
          vICMS: '18.00',
        },
      };

      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');

      expect(xml).toContain('<ICMS00>');
      expect(xml).toContain('<CST>00</CST>');
      expect(xml).toContain('<modBC>3</modBC>');
      expect(xml).toContain('<vBC>100.00</vBC>');
      expect(xml).toContain('<pICMS>18.00</pICMS>');
      expect(xml).toContain('<vICMS>18.00</vICMS>');
      expect(xml).toContain('</ICMS00>');
    });

    it('should produce valid XML without unclosed tags', () => {
      const nfe = createMockNFe();
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');

      // Count opening and closing tags for key elements
      const openNFe = (xml.match(/<NFe[ >]/g) || []).length;
      const closeNFe = (xml.match(/<\/NFe>/g) || []).length;
      expect(openNFe).toBe(closeNFe);

      const openInfNFe = (xml.match(/<infNFe[ >]/g) || []).length;
      const closeInfNFe = (xml.match(/<\/infNFe>/g) || []).length;
      expect(openInfNFe).toBe(closeInfNFe);

      // Verify the XML contains <NFe and ends with </NFe>
      expect(xml).toContain('<NFe');
      expect(xml).toMatch(/<\/NFe>$/);
    });

    it('should include product data with correct values', () => {
      const nfe = createMockNFe();
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');

      expect(xml).toContain('<cProd>001</cProd>');
      expect(xml).toContain('<xProd>NOTEBOOK</xProd>');
      expect(xml).toContain('<NCM>84715010</NCM>');
      expect(xml).toContain('<CFOP>5102</CFOP>');
      expect(xml).toContain('<vProd>100.00</vProd>');
      expect(xml).toContain('<indTot>1</indTot>');
    });

    it('should include emitente and destinatario CNPJ', () => {
      const nfe = createMockNFe();
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');

      expect(xml).toContain('<CNPJ>12345678000199</CNPJ>');
      expect(xml).toContain('<CNPJ>98765432000188</CNPJ>');
    });

    it('should include payment data', () => {
      const nfe = createMockNFe();
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');

      expect(xml).toContain('<detPag>');
      expect(xml).toContain('<tPag>01</tPag>');
      expect(xml).toContain('<vPag>100.00</vPag>');
    });

    it('should include transport modality', () => {
      const nfe = createMockNFe();
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');

      expect(xml).toContain('<modFrete>9</modFrete>');
    });

    it('should serialize ICMS20 with reduction', () => {
      const nfe = createMockNFe();
      nfe.det[0].imposto.ICMS = {
        ICMS20: {
          orig: OrigemMercadoria.NACIONAL, CST: '20', modBC: '3', pRedBC: '30.00',
          vBC: '70.00', pICMS: '18.00', vICMS: '12.60',
        },
      };
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<ICMS20>');
      expect(xml).toContain('<pRedBC>30.00</pRedBC>');
      expect(xml).toContain('<vICMS>12.60</vICMS>');
      expect(xml).toContain('</ICMS20>');
    });

    it('should serialize ICMS40 for exempt/non-taxed', () => {
      const nfe = createMockNFe();
      nfe.det[0].imposto.ICMS = {
        ICMS40: { orig: OrigemMercadoria.NACIONAL, CST: '41' },
      };
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<ICMS40>');
      expect(xml).toContain('<CST>41</CST>');
      expect(xml).toContain('</ICMS40>');
    });

    it('should serialize IPITrib', () => {
      const nfe = createMockNFe();
      nfe.det[0].imposto.IPI = {
        IPITrib: { cEnq: '999', CST: '50', vBC: '10.00', pIPI: '5.00', vIPI: '0.50' },
      };
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<IPI>');
      expect(xml).toContain('<cEnq>999</cEnq>');
      expect(xml).toContain('<IPITrib>');
      expect(xml).toContain('<CST>50</CST>');
      expect(xml).toContain('<vIPI>0.50</vIPI>');
    });

    it('should serialize IPINT', () => {
      const nfe = createMockNFe();
      nfe.det[0].imposto.IPI = {
        IPINT: { cEnq: '999', CST: '53' },
      };
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<IPINT>');
      expect(xml).toContain('<CST>53</CST>');
    });

    it('should serialize PISAliq', () => {
      const nfe = createMockNFe();
      nfe.det[0].imposto.PIS = {
        PISAliq: { CST: '01', vBC: '10.00', pPIS: '1.65', vPIS: '0.17' },
      };
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<PISAliq>');
      expect(xml).toContain('<pPIS>1.65</pPIS>');
      expect(xml).toContain('<vPIS>0.17</vPIS>');
    });

    it('should serialize COFINSAliq', () => {
      const nfe = createMockNFe();
      nfe.det[0].imposto.COFINS = {
        COFINSAliq: { CST: '01', vBC: '10.00', pCOFINS: '7.60', vCOFINS: '0.76' },
      };
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<COFINSAliq>');
      expect(xml).toContain('<pCOFINS>7.60</pCOFINS>');
      expect(xml).toContain('<vCOFINS>0.76</vCOFINS>');
    });

    it('should use CPF for emitente when CNPJ is absent', () => {
      const nfe = createMockNFe();
      delete (nfe.emit as any).CNPJ;
      nfe.emit.CPF = '12345678901';
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<CPF>12345678901</CPF>');
    });

    it('should use CPF for destinatario when CNPJ is absent', () => {
      const nfe = createMockNFe();
      delete (nfe.dest as any).CNPJ;
      nfe.dest.CPF = '98765432100';
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<CPF>98765432100</CPF>');
    });

    it('should use idEstrangeiro for foreign destinatario', () => {
      const nfe = createMockNFe();
      delete (nfe.dest as any).CNPJ;
      nfe.dest.idEstrangeiro = 'PASSPORT123';
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<idEstrangeiro>PASSPORT123</idEstrangeiro>');
    });

    it('should serialize transporta section', () => {
      const nfe = createMockNFe();
      nfe.transp.modFrete = '0';
      nfe.transp.transporta = {
        CNPJ: '11222333000181', xNome: 'TRANSPORTADORA TESTE',
        xEnder: 'RUA FRETE 1', xMun: 'BH', UF: 'MG',
      };
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<transporta>');
      expect(xml).toContain('<xNome>TRANSPORTADORA TESTE</xNome>');
      expect(xml).toContain('</transporta>');
    });

    it('should serialize veicTransp section', () => {
      const nfe = createMockNFe();
      nfe.transp.veicTransp = { placa: 'ABC1D23', UF: 'MG', RNTRC: '12345678' };
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<veicTransp>');
      expect(xml).toContain('<placa>ABC1D23</placa>');
      expect(xml).toContain('<RNTRC>12345678</RNTRC>');
    });

    it('should serialize vol section', () => {
      const nfe = createMockNFe();
      nfe.transp.vol = [{ qVol: '10', esp: 'CAIXA', pesoL: '50.000', pesoB: '52.000' }];
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<vol>');
      expect(xml).toContain('<qVol>10</qVol>');
      expect(xml).toContain('<esp>CAIXA</esp>');
      expect(xml).toContain('<pesoL>50.000</pesoL>');
    });

    it('should serialize cobr with fat and dup', () => {
      const nfe = createMockNFe();
      nfe.cobr = {
        fat: { nFat: '001', vOrig: '10.00', vDesc: '0.00', vLiq: '10.00' },
        dup: [{ nDup: '001', dVenc: '2024-06-10', vDup: '10.00' }],
      };
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<cobr>');
      expect(xml).toContain('<fat>');
      expect(xml).toContain('<nFat>001</nFat>');
      expect(xml).toContain('<dup>');
      expect(xml).toContain('<dVenc>2024-06-10</dVenc>');
      expect(xml).toContain('</cobr>');
    });

    it('should serialize infAdic', () => {
      const nfe = createMockNFe();
      nfe.infAdic = { infAdFisco: 'INFO FISCO', infCpl: 'COMPLEMENTO' };
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<infAdic>');
      expect(xml).toContain('<infAdFisco>INFO FISCO</infAdFisco>');
      expect(xml).toContain('<infCpl>COMPLEMENTO</infCpl>');
    });

    it('should serialize ICMSUFDest as the LAST element of imposto (XSD order)', () => {
      const nfe = createMockNFe();
      nfe.det[0].imposto.ICMSUFDest = {
        vBCUFDest: '450.00',
        pICMSUFDest: '18.00',
        pICMSInter: '12.00',
        pICMSInterPart: '100.00',
        vICMSUFDest: '27.00',
        vICMSUFRemet: '0.00',
      };
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');

      expect(xml).toContain('<ICMSUFDest>');
      expect(xml).toContain('<vBCUFDest>450.00</vBCUFDest>');
      expect(xml).toContain('<pICMSInterPart>100.00</pICMSInterPart>');
      // Ordem XSD dentro de <imposto>: ICMS -> IPI -> PIS -> COFINS -> ICMSUFDest
      const posICMSUFDest = xml.indexOf('<ICMSUFDest>');
      const posICMS = xml.indexOf('<ICMS>');
      const posPIS = xml.indexOf('<PIS>');
      const posCOFINS = xml.indexOf('<COFINS>');
      expect(posICMSUFDest).toBeGreaterThan(posICMS);
      expect(posICMSUFDest).toBeGreaterThan(posPIS);
      expect(posICMSUFDest).toBeGreaterThan(posCOFINS);
      // E antes do fechamento do imposto do item
      expect(posICMSUFDest).toBeLessThan(xml.indexOf('</imposto>'));
    });

    it('should serialize infRespTec', () => {
      const nfe = createMockNFe();
      nfe.infRespTec = {
        CNPJ: '99888777000166', xContato: 'SUPORTE',
        email: 'suporte@teste.com', fone: '11999887766',
      };
      const xml = generator.generateInfNFe(nfe, '31240512345678000199550010000000011000000010');
      expect(xml).toContain('<infRespTec>');
      expect(xml).toContain('<CNPJ>99888777000166</CNPJ>');
      expect(xml).toContain('<xContato>SUPORTE</xContato>');
      expect(xml).toContain('<email>suporte@teste.com</email>');
    });
  });

  describe('wrapEnvelope', () => {
    it('should wrap signed XML in enviNFe envelope', () => {
      const signedXml = '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe/></NFe>';
      const envelope = generator.wrapEnvelope(signedXml, '123456');

      expect(envelope).toContain('<enviNFe');
      expect(envelope).toContain('versao="4.00"');
      expect(envelope).toContain('<idLote>123456</idLote>');
      expect(envelope).toContain('<indSinc>1</indSinc>');
      expect(envelope).toContain(signedXml);
      expect(envelope).toContain('</enviNFe>');
    });

    it('should include SEFAZ namespace', () => {
      const envelope = generator.wrapEnvelope('<NFe/>', '1');

      expect(envelope).toContain('xmlns="http://www.portalfiscal.inf.br/nfe"');
    });
  });
});
