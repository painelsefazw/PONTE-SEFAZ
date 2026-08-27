import {
  TransmissaoNFeUseCase,
  TransmissaoResult,
} from '../src/application/TransmissaoNFeUseCase';
import {
  NFe,
  TipoAmbiente,
  TipoEmissao,
  FinalidadeNFe,
  IndicadorPresenca,
  OrigemMercadoria,
} from '../src/domain/models';
import { NFeStatus } from '../src/infrastructure/db/migrations';

// ============================================================================
// Mock SEFAZ XML Responses
// ============================================================================

const AUTHORIZED_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
<soap12:Body>
<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo>
  <protNFe versao="4.00">
    <infProt>
      <tpAmb>2</tpAmb><verAplic>SVRS</verAplic>
      <chNFe>31240512345678000199550010000000011000000010</chNFe>
      <dhRecbto>2024-05-10T10:00:00-03:00</dhRecbto>
      <nProt>131240000000001</nProt><digVal>abc123</digVal>
      <cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>
    </infProt>
  </protNFe>
</retEnviNFe>
</nfeDadosMsg>
</soap12:Body>
</soap12:Envelope>`;

const REJECTED_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
<soap12:Body>
<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo>
  <protNFe versao="4.00">
    <infProt>
      <tpAmb>2</tpAmb><verAplic>SVRS</verAplic>
      <chNFe>31240512345678000199550010000000011000000010</chNFe>
      <dhRecbto>2024-05-10T10:00:00-03:00</dhRecbto>
      <digVal>abc123</digVal>
      <cStat>999</cStat><xMotivo>Rejeicao: erro nao catalogado</xMotivo>
    </infProt>
  </protNFe>
</retEnviNFe>
</nfeDadosMsg>
</soap12:Body>
</soap12:Envelope>`;

// ============================================================================
// Mock NFe Fixture
// ============================================================================

function createTestNFe(): NFe {
  return {
    ide: {
      cUF: '31',
      cNF: '00000001',
      natOp: 'VENDA',
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
      xNome: 'EMPRESA TESTE',
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
      },
      IE: '1234567890',
      CRT: '1',
    },
    dest: {
      CNPJ: '98765432000188',
      xNome: 'CLIENTE TESTE',
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
    },
    det: [
      {
        nItem: '1',
        prod: {
          cProd: '001',
          cEAN: 'SEM GTIN',
          xProd: 'PRODUTO TESTE',
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
          ICMS: {
            ICMSSN102: {
              orig: OrigemMercadoria.NACIONAL,
              CSOSN: '102',
            },
          },
          PIS: { PISOutr: { CST: '99' } },
          COFINS: { COFINSOutr: { CST: '99' } },
        },
      },
    ],
    total: {
      ICMSTot: {
        vBC: '0.00', vICMS: '0.00', vICMSDeson: '0.00',
        vFCP: '0.00', vBCST: '0.00', vST: '0.00',
        vFCPST: '0.00', vFCPSTRet: '0.00',
        vProd: '100.00', vFrete: '0.00', vSeg: '0.00', vDesc: '0.00',
        vII: '0.00', vIPI: '0.00', vIPIDevol: '0.00', vPIS: '0.00', vCOFINS: '0.00',
        vOutro: '0.00', vNF: '100.00',
      },
    },
    transp: { modFrete: '9' },
    pag: { detPag: [{ tPag: '01', vPag: '100.00' }] },
  };
}

// ============================================================================
// Mock Implementations
// ============================================================================

function createMockXmlGenerator() {
  return {
    generateInfNFe: jest.fn().mockReturnValue('<NFe><infNFe Id="NFe123"/></NFe>'),
    wrapEnvelope: jest.fn().mockReturnValue('<enviNFe><NFe/></enviNFe>'),
  };
}

function createMockSigner() {
  return {
    sign: jest.fn().mockReturnValue('<NFe><infNFe Id="NFe123"/><Signature/></NFe>'),
    getCertificateInfo: jest.fn().mockReturnValue({
      subject: 'CN=EMPRESA TESTE',
      issuer: 'CN=EMPRESA TESTE',
      validFrom: new Date(),
      validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      serialNumber: '01',
    }),
  };
}

function createMockSoapClient() {
  return {
    send: jest.fn().mockResolvedValue(AUTHORIZED_RESPONSE),
  };
}

function createMockRepository() {
  return {
    save: jest.fn().mockResolvedValue(1),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    findByChave: jest.fn().mockResolvedValue(null),
    initialize: jest.fn().mockResolvedValue(undefined),
    findByEmitente: jest.fn().mockResolvedValue([]),
    withTransaction: jest.fn(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TransmissaoNFeUseCase', () => {
  describe('Happy path — NF-e authorized (cStat 100)', () => {
    it('should execute the full authorization flow and return success', async () => {
      const xmlGenerator = createMockXmlGenerator();
      const signer = createMockSigner();
      const soapClient = createMockSoapClient();
      const repository = createMockRepository();

      const useCase = new TransmissaoNFeUseCase({
        xmlGenerator: xmlGenerator as any,
        signer: signer as any,
        soapClient: soapClient as any,
        repository: repository as any,
      });

      const nfe = createTestNFe();
      const result = await useCase.execute(nfe, 'MG', TipoAmbiente.HOMOLOGACAO);

      expect(result.success).toBe(true);
      expect(result.cStat).toBe('100');
      expect(result.xMotivo).toBe('Autorizado o uso da NF-e');
      expect(result.nProt).toBe('131240000000001');
      expect(result.chaveAcesso).toHaveLength(44);
    });

    it('should call all dependencies in the correct order', async () => {
      const xmlGenerator = createMockXmlGenerator();
      const signer = createMockSigner();
      const soapClient = createMockSoapClient();
      const repository = createMockRepository();

      const callOrder: string[] = [];
      xmlGenerator.generateInfNFe.mockImplementation(() => {
        callOrder.push('generateInfNFe');
        return '<NFe><infNFe Id="NFe123"/></NFe>';
      });
      signer.sign.mockImplementation(() => {
        callOrder.push('sign');
        return '<NFe><infNFe Id="NFe123"/><Signature/></NFe>';
      });
      xmlGenerator.wrapEnvelope.mockImplementation(() => {
        callOrder.push('wrapEnvelope');
        return '<enviNFe><NFe/></enviNFe>';
      });
      repository.save.mockImplementation(async () => {
        callOrder.push('save');
        return 1;
      });
      soapClient.send.mockImplementation(async () => {
        callOrder.push('send');
        return AUTHORIZED_RESPONSE;
      });
      repository.updateStatus.mockImplementation(async () => {
        callOrder.push('updateStatus');
      });

      const useCase = new TransmissaoNFeUseCase({
        xmlGenerator: xmlGenerator as any,
        signer: signer as any,
        soapClient: soapClient as any,
        repository: repository as any,
      });

      await useCase.execute(createTestNFe(), 'MG', TipoAmbiente.HOMOLOGACAO);

      expect(callOrder).toEqual([
        'generateInfNFe',
        'sign',
        'wrapEnvelope',
        'save',
        'send',
        'updateStatus',
      ]);
    });

    it('should update DB status to AUTORIZADA', async () => {
      const xmlGenerator = createMockXmlGenerator();
      const signer = createMockSigner();
      const soapClient = createMockSoapClient();
      const repository = createMockRepository();

      const useCase = new TransmissaoNFeUseCase({
        xmlGenerator: xmlGenerator as any,
        signer: signer as any,
        soapClient: soapClient as any,
        repository: repository as any,
      });

      await useCase.execute(createTestNFe(), 'MG', TipoAmbiente.HOMOLOGACAO);

      expect(repository.updateStatus).toHaveBeenCalledWith(
        expect.any(String),
        NFeStatus.AUTORIZADA,
        expect.objectContaining({
          cstat: '100',
          nprot: '131240000000001',
        }),
      );
    });
  });

  describe('Rejected NF-e (cStat 999)', () => {
    it('should return success=false and update status to REJEITADA', async () => {
      const xmlGenerator = createMockXmlGenerator();
      const signer = createMockSigner();
      const soapClient = createMockSoapClient();
      const repository = createMockRepository();

      soapClient.send.mockResolvedValue(REJECTED_RESPONSE);

      const useCase = new TransmissaoNFeUseCase({
        xmlGenerator: xmlGenerator as any,
        signer: signer as any,
        soapClient: soapClient as any,
        repository: repository as any,
      });

      const result = await useCase.execute(createTestNFe(), 'MG', TipoAmbiente.HOMOLOGACAO);

      expect(result.success).toBe(false);
      expect(result.cStat).toBe('999');
      expect(result.xMotivo).toContain('Rejeicao');

      expect(repository.updateStatus).toHaveBeenCalledWith(
        expect.any(String),
        NFeStatus.REJEITADA,
        expect.objectContaining({
          cstat: '999',
        }),
      );
    });
  });

  describe('SOAP timeout error', () => {
    it('should update status to ERRO and propagate the error', async () => {
      const xmlGenerator = createMockXmlGenerator();
      const signer = createMockSigner();
      const soapClient = createMockSoapClient();
      const repository = createMockRepository();

      const timeoutError = new Error('Timeout ao comunicar com SEFAZ (30000ms)');
      soapClient.send.mockRejectedValue(timeoutError);

      const useCase = new TransmissaoNFeUseCase({
        xmlGenerator: xmlGenerator as any,
        signer: signer as any,
        soapClient: soapClient as any,
        repository: repository as any,
      });

      await expect(
        useCase.execute(createTestNFe(), 'MG', TipoAmbiente.HOMOLOGACAO),
      ).rejects.toThrow('Timeout');

      expect(repository.updateStatus).toHaveBeenCalledWith(
        expect.any(String),
        NFeStatus.ERRO,
        expect.objectContaining({
          xmotivo: expect.stringContaining('Timeout'),
        }),
      );
    });
  });

  describe('Database save failure', () => {
    it('should propagate the DB error without crashing on updateStatus', async () => {
      const xmlGenerator = createMockXmlGenerator();
      const signer = createMockSigner();
      const soapClient = createMockSoapClient();
      const repository = createMockRepository();

      const dbError = new Error('Connection refused: PostgreSQL not available');
      repository.save.mockRejectedValue(dbError);
      // updateStatus will also fail since DB is down
      repository.updateStatus.mockRejectedValue(new Error('DB down'));

      const useCase = new TransmissaoNFeUseCase({
        xmlGenerator: xmlGenerator as any,
        signer: signer as any,
        soapClient: soapClient as any,
        repository: repository as any,
      });

      await expect(
        useCase.execute(createTestNFe(), 'MG', TipoAmbiente.HOMOLOGACAO),
      ).rejects.toThrow('Connection refused');

      // SOAP should NOT have been called since save failed before it
      expect(soapClient.send).not.toHaveBeenCalled();
    });
  });
});
