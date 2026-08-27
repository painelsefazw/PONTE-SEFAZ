import { ConsultaProtocoloUseCase } from '../../src/application/ConsultaProtocoloUseCase';

const mockSoapClient = { send: jest.fn() } as any;
const mockRepository = {
  findByChave: jest.fn(),
  updateStatus: jest.fn(),
} as any;

function makeUseCase() {
  return new ConsultaProtocoloUseCase(mockSoapClient, mockRepository);
}

const SOAP_CONSULTA_AUTORIZADA = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">
      <retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>2</tpAmb>
        <verAplic>SVRS202405</verAplic>
        <cStat>100</cStat>
        <xMotivo>Autorizado o uso da NF-e</xMotivo>
        <cUF>31</cUF>
        <protNFe versao="4.00">
          <infProt>
            <tpAmb>2</tpAmb>
            <verAplic>SVRS202405</verAplic>
            <chNFe>31240512345678000199550010000000011000000019</chNFe>
            <dhRecbto>2024-05-10T10:00:01-03:00</dhRecbto>
            <nProt>131240000000001</nProt>
            <digVal>dGVzdGU=</digVal>
            <cStat>100</cStat>
            <xMotivo>Autorizado o uso da NF-e</xMotivo>
          </infProt>
        </protNFe>
      </retConsSitNFe>
    </nfeResultMsg>
  </soap12:Body>
</soap12:Envelope>`;

const SOAP_CONSULTA_CANCELADA = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">
      <retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>2</tpAmb>
        <verAplic>SVRS202405</verAplic>
        <cStat>101</cStat>
        <xMotivo>Cancelamento de NF-e homologado</xMotivo>
        <cUF>31</cUF>
        <protNFe versao="4.00">
          <infProt>
            <tpAmb>2</tpAmb>
            <verAplic>SVRS202405</verAplic>
            <chNFe>31240512345678000199550010000000011000000019</chNFe>
            <dhRecbto>2024-05-10T12:00:01-03:00</dhRecbto>
            <nProt>131240000000002</nProt>
            <digVal>dGVzdGU=</digVal>
            <cStat>101</cStat>
            <xMotivo>Cancelamento de NF-e homologado</xMotivo>
          </infProt>
        </protNFe>
      </retConsSitNFe>
    </nfeResultMsg>
  </soap12:Body>
</soap12:Envelope>`;

describe('ConsultaProtocoloUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return authorized NF-e status', async () => {
    mockSoapClient.send.mockResolvedValue(SOAP_CONSULTA_AUTORIZADA);
    mockRepository.findByChave.mockResolvedValue({ chaveAcesso: '31240512345678000199550010000000011000000019' });

    const uc = makeUseCase();
    const result = await uc.execute('31240512345678000199550010000000011000000019', 'MG', '2');

    expect(result.cStat).toBe('100');
    expect(result.nProt).toBe('131240000000001');
    expect(mockRepository.updateStatus).toHaveBeenCalledWith(
      '31240512345678000199550010000000011000000019',
      'AUTORIZADA',
      expect.objectContaining({ cstat: '100' }),
    );
  });

  test('should handle cancelled NF-e', async () => {
    mockSoapClient.send.mockResolvedValue(SOAP_CONSULTA_CANCELADA);
    mockRepository.findByChave.mockResolvedValue({ chaveAcesso: '31240512345678000199550010000000011000000019' });

    const uc = makeUseCase();
    const result = await uc.execute('31240512345678000199550010000000011000000019', 'MG', '2');

    expect(result.cStat).toBe('101');
    expect(mockRepository.updateStatus).toHaveBeenCalledWith(
      '31240512345678000199550010000000011000000019',
      'CANCELADA',
      expect.objectContaining({ cstat: '101' }),
    );
  });

  test('should not update DB if NF-e not found locally', async () => {
    mockSoapClient.send.mockResolvedValue(SOAP_CONSULTA_AUTORIZADA);
    mockRepository.findByChave.mockResolvedValue(null);

    const uc = makeUseCase();
    const result = await uc.execute('31240512345678000199550010000000011000000019', 'MG', '2');

    expect(result.cStat).toBe('100');
    expect(mockRepository.updateStatus).not.toHaveBeenCalled();
  });
});
