import { StatusServicoUseCase } from '../../src/application/StatusServicoUseCase';
import { StatusServicoXmlGenerator } from '../../src/infrastructure/xml/StatusServicoXmlGenerator';

const SOAP_RESPONSE_ONLINE = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">
      <retConsStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>2</tpAmb>
        <verAplic>SVR-NFE-2024</verAplic>
        <cStat>107</cStat>
        <xMotivo>Servico em Operacao</xMotivo>
        <cUF>31</cUF>
        <dhRecbto>2024-05-10T10:00:00-03:00</dhRecbto>
        <tMed>1</tMed>
      </retConsStatServ>
    </nfeResultMsg>
  </soap12:Body>
</soap12:Envelope>`;

const SOAP_RESPONSE_OFFLINE = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">
      <retConsStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>2</tpAmb>
        <verAplic>SVR-NFE-2024</verAplic>
        <cStat>109</cStat>
        <xMotivo>Servico Paralisado Temporariamente</xMotivo>
        <cUF>31</cUF>
        <dhRecbto>2024-05-10T10:00:00-03:00</dhRecbto>
        <tMed>0</tMed>
      </retConsStatServ>
    </nfeResultMsg>
  </soap12:Body>
</soap12:Envelope>`;

describe('StatusServicoUseCase', () => {
  const mockSoapClient = { send: jest.fn() } as any;

  beforeEach(() => jest.clearAllMocks());

  test('should return online=true when cStat is 107', async () => {
    mockSoapClient.send.mockResolvedValue(SOAP_RESPONSE_ONLINE);

    const useCase = new StatusServicoUseCase({
      xmlGenerator: new StatusServicoXmlGenerator(),
      soapClient: mockSoapClient,
    });

    const result = await useCase.execute('MG', '2', '31');
    expect(result.online).toBe(true);
    expect(result.cStat).toBe('107');
    expect(result.xMotivo).toBe('Servico em Operacao');
    expect(result.tMed).toBe('1');
  });

  test('should return online=false when cStat is not 107', async () => {
    mockSoapClient.send.mockResolvedValue(SOAP_RESPONSE_OFFLINE);

    const useCase = new StatusServicoUseCase({
      xmlGenerator: new StatusServicoXmlGenerator(),
      soapClient: mockSoapClient,
    });

    const result = await useCase.execute('MG', '2', '31');
    expect(result.online).toBe(false);
    expect(result.cStat).toBe('109');
  });

  test('should call soap client with correct endpoint', async () => {
    mockSoapClient.send.mockResolvedValue(SOAP_RESPONSE_ONLINE);

    const useCase = new StatusServicoUseCase({
      xmlGenerator: new StatusServicoXmlGenerator(),
      soapClient: mockSoapClient,
    });

    await useCase.execute('MG', '2', '31');

    expect(mockSoapClient.send).toHaveBeenCalledTimes(1);
    const [, endpoint] = mockSoapClient.send.mock.calls[0];
    expect(endpoint).toContain('StatusServico4');
  });
});
