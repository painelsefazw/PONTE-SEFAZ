import { DanfeGenerator, DanfeInput } from '../../src/infrastructure/pdf/DanfeGenerator';
import { NFe, TipoAmbiente, TipoEmissao, FinalidadeNFe, IndicadorPresenca, OrigemMercadoria } from '../../src/domain/models';

function createMockNFe(): NFe {
  return {
    ide: {
      cUF: '31', cNF: '00000001', natOp: 'VENDA', mod: '55', serie: '1', nNF: '1',
      dhEmi: '2024-05-10T10:00:00-03:00', tpNF: '1', idDest: '1', cMunFG: '3106200',
      tpImp: '1', tpEmis: TipoEmissao.NORMAL, cDV: '9', tpAmb: TipoAmbiente.HOMOLOGACAO,
      finNFe: FinalidadeNFe.NORMAL, indFinal: '1', indPres: IndicadorPresenca.PRESENCIAL,
      procEmi: '0', verProc: '1.0.0',
    },
    emit: {
      CNPJ: '12345678000199', xNome: 'EMPRESA TESTE LTDA', xFant: 'TESTE',
      enderEmit: { xLgr: 'RUA TESTE', nro: '100', xBairro: 'CENTRO', cMun: '3106200', xMun: 'BELO HORIZONTE', UF: 'MG', CEP: '30130000', cPais: '1058', xPais: 'BRASIL' },
      IE: '1234567890', CRT: '1',
    },
    dest: {
      CNPJ: '98765432000188', xNome: 'CLIENTE TESTE',
      enderDest: { xLgr: 'AV BRASIL', nro: '200', xBairro: 'SAVASSI', cMun: '3106200', xMun: 'BELO HORIZONTE', UF: 'MG', CEP: '30140071', cPais: '1058', xPais: 'BRASIL' },
      indIEDest: '1', IE: '0987654321',
    },
    det: [{
      nItem: '1',
      prod: { cProd: '001', cEAN: 'SEM GTIN', xProd: 'PRODUTO TESTE', NCM: '84715010', CFOP: '5102', uCom: 'UN', qCom: '2.0000', vUnCom: '10.00', vProd: '20.00', cEANTrib: 'SEM GTIN', uTrib: 'UN', qTrib: '2.0000', vUnTrib: '10.00', indTot: '1' },
      imposto: { ICMS: { ICMSSN102: { orig: OrigemMercadoria.NACIONAL, CSOSN: '102' } }, PIS: { PISOutr: { CST: '99' } }, COFINS: { COFINSOutr: { CST: '99' } } },
    }],
    total: { ICMSTot: { vBC: '0.00', vICMS: '0.00', vICMSDeson: '0.00', vFCP: '0.00', vBCST: '0.00', vST: '0.00', vFCPST: '0.00', vFCPSTRet: '0.00', vProd: '20.00', vFrete: '0.00', vSeg: '0.00', vDesc: '0.00', vII: '0.00', vIPI: '0.00', vIPIDevol: '0.00', vPIS: '0.00', vCOFINS: '0.00', vOutro: '0.00', vNF: '20.00' } },
    transp: { modFrete: '9' },
    pag: { detPag: [{ tPag: '01', vPag: '20.00' }] },
  };
}

describe('DanfeGenerator', () => {
  let generator: DanfeGenerator;

  beforeEach(() => {
    generator = new DanfeGenerator();
  });

  test('should generate a PDF buffer', async () => {
    const input: DanfeInput = {
      nfe: createMockNFe(),
      chaveAcesso: '31240512345678000199550010000000011000000019',
      nProt: '131240000000001',
      dhRecbto: '2024-05-10T10:00:01-03:00',
    };
    const buffer = await generator.generate(input);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('should generate PDF with multiple items', async () => {
    const nfe = createMockNFe();
    nfe.det.push({
      nItem: '2',
      prod: { cProd: '002', cEAN: 'SEM GTIN', xProd: 'OUTRO PRODUTO', NCM: '84715010', CFOP: '5102', uCom: 'UN', qCom: '1.0000', vUnCom: '5.00', vProd: '5.00', cEANTrib: 'SEM GTIN', uTrib: 'UN', qTrib: '1.0000', vUnTrib: '5.00', indTot: '1' },
      imposto: { ICMS: { ICMSSN102: { orig: OrigemMercadoria.NACIONAL, CSOSN: '102' } }, PIS: { PISOutr: { CST: '99' } }, COFINS: { COFINSOutr: { CST: '99' } } },
    });
    const buffer = await generator.generate({
      nfe,
      chaveAcesso: '31240512345678000199550010000000011000000019',
      nProt: '131240000000001',
      dhRecbto: '2024-05-10T10:00:01-03:00',
    });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
  });

  test('should generate PDF with infAdic', async () => {
    const nfe = createMockNFe();
    nfe.infAdic = { infCpl: 'Informacao complementar de teste para validacao do DANFE' };
    const buffer = await generator.generate({
      nfe,
      chaveAcesso: '31240512345678000199550010000000011000000019',
      nProt: '131240000000001',
      dhRecbto: '2024-05-10T10:00:01-03:00',
    });
    expect(buffer).toBeInstanceOf(Buffer);
  });
});
