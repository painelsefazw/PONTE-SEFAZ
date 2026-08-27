import { parseAutorizacaoResponse, parseStatusServicoResponse, nfeAutorizada } from '../../src/infrastructure/soap/ResponseParser';

const SOAP_AUTORIZADA_ALERTA = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
      <retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>2</tpAmb>
        <verAplic>SVRS202607</verAplic>
        <cStat>104</cStat>
        <xMotivo>Lote processado</xMotivo>
        <protNFe versao="4.00">
          <infProt>
            <tpAmb>2</tpAmb>
            <verAplic>SVRS202607</verAplic>
            <chNFe>31240512345678000199550010000000011000000019</chNFe>
            <dhRecbto>2026-08-11T10:00:01-03:00</dhRecbto>
            <nProt>131260000000009</nProt>
            <digVal>dGVzdGU=</digVal>
            <cStat>120</cStat>
            <xMotivo>Autorizado o uso da NF-e, com alerta</xMotivo>
            <cMsg>1</cMsg>
            <xMsg>Destinatario com situacao cadastral irregular</xMsg>
          </infProt>
        </protNFe>
      </retEnviNFe>
    </nfeResultMsg>
  </soap12:Body>
</soap12:Envelope>`;

const SOAP_AUTORIZADA = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
      <retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>2</tpAmb>
        <verAplic>SVRS202405</verAplic>
        <cStat>104</cStat>
        <xMotivo>Lote processado</xMotivo>
        <cUF>43</cUF>
        <dhRecbto>2024-05-10T10:00:01-03:00</dhRecbto>
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
      </retEnviNFe>
    </nfeResultMsg>
  </soap12:Body>
</soap12:Envelope>`;

const SOAP_REJEITADA = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
      <retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>2</tpAmb>
        <verAplic>SVRS202405</verAplic>
        <cStat>104</cStat>
        <xMotivo>Lote processado</xMotivo>
        <protNFe versao="4.00">
          <infProt>
            <tpAmb>2</tpAmb>
            <verAplic>SVRS202405</verAplic>
            <chNFe>31240512345678000199550010000000011000000019</chNFe>
            <dhRecbto>2024-05-10T10:00:01-03:00</dhRecbto>
            <nProt></nProt>
            <digVal></digVal>
            <cStat>539</cStat>
            <xMotivo>Rejeicao: Duplicidade de NF-e</xMotivo>
          </infProt>
        </protNFe>
      </retEnviNFe>
    </nfeResultMsg>
  </soap12:Body>
</soap12:Envelope>`;

const SOAP_STATUS = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeStatusServico4">
      <retConsStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>2</tpAmb>
        <verAplic>SVRS202405</verAplic>
        <cStat>107</cStat>
        <xMotivo>Servico em Operacao</xMotivo>
        <cUF>43</cUF>
        <dhRecbto>2024-05-10T10:00:00-03:00</dhRecbto>
        <tMed>1</tMed>
      </retConsStatServ>
    </nfeResultMsg>
  </soap12:Body>
</soap12:Envelope>`;

const SOAP_FAULT = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <soap12:Fault>
      <soap12:Code><soap12:Value>soap12:Sender</soap12:Value></soap12:Code>
      <soap12:Reason><soap12:Text>Erro de processamento</soap12:Text></soap12:Reason>
    </soap12:Fault>
  </soap12:Body>
</soap12:Envelope>`;

describe('ResponseParser', () => {
  describe('parseAutorizacaoResponse', () => {
    test('should parse authorized NF-e response (cStat 100)', () => {
      const result = parseAutorizacaoResponse(SOAP_AUTORIZADA);
      expect(result.cStat).toBe('104');
      expect(result.xMotivo).toBe('Lote processado');
      expect(result.protNFe).toBeDefined();
      expect(result.protNFe!.infProt.cStat).toBe('100');
      expect(result.protNFe!.infProt.xMotivo).toBe('Autorizado o uso da NF-e');
      expect(result.protNFe!.infProt.nProt).toBe('131240000000001');
      expect(result.protNFe!.infProt.chNFe).toBe('31240512345678000199550010000000011000000019');
    });

    test('should parse rejected NF-e response (cStat 539)', () => {
      const result = parseAutorizacaoResponse(SOAP_REJEITADA);
      expect(result.protNFe).toBeDefined();
      expect(result.protNFe!.infProt.cStat).toBe('539');
      expect(result.protNFe!.infProt.xMotivo).toContain('Duplicidade');
    });

    test('should parse authorized-with-alert NF-e response (cStat 120) and extract alert', () => {
      const result = parseAutorizacaoResponse(SOAP_AUTORIZADA_ALERTA);
      expect(result.protNFe).toBeDefined();
      expect(result.protNFe!.infProt.cStat).toBe('120');
      expect(result.protNFe!.infProt.nProt).toBe('131260000000009');
      expect(result.protNFe!.infProt.cMsg).toBe('1');
      expect(result.protNFe!.infProt.xMsg).toBe('Destinatario com situacao cadastral irregular');
    });

    test('should throw on SOAP fault', () => {
      expect(() => parseAutorizacaoResponse(SOAP_FAULT)).toThrow('SOAP Fault');
    });

    test('should throw on invalid XML', () => {
      expect(() => parseAutorizacaoResponse('<invalid')).toThrow();
    });

    test('should throw when retEnviNFe is missing', () => {
      const noRetEnvi = `<?xml version="1.0"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><other>data</other></soap12:Body></soap12:Envelope>`;
      expect(() => parseAutorizacaoResponse(noRetEnvi)).toThrow('retEnviNFe');
    });
  });

  describe('parseStatusServicoResponse', () => {
    test('should parse status servico response (cStat 107)', () => {
      const result = parseStatusServicoResponse(SOAP_STATUS);
      expect(result.cStat).toBe('107');
      expect(result.xMotivo).toBe('Servico em Operacao');
      expect(result.cUF).toBe('43');
      expect(result.tMed).toBe('1');
      expect(result.tpAmb).toBe('2');
    });

    test('should throw on SOAP fault', () => {
      expect(() => parseStatusServicoResponse(SOAP_FAULT)).toThrow('SOAP Fault');
    });
  });

  describe('nfeAutorizada (NT 2026.002 - cStat 120)', () => {
    test('trata 100, 120 e 150 como autorizada', () => {
      expect(nfeAutorizada('100')).toBe(true);
      expect(nfeAutorizada('120')).toBe(true);
      expect(nfeAutorizada('150')).toBe(true);
    });

    test('rejeicoes e vazios nao sao autorizada', () => {
      expect(nfeAutorizada('110')).toBe(false);
      expect(nfeAutorizada('539')).toBe(false);
      expect(nfeAutorizada('225')).toBe(false);
      expect(nfeAutorizada('')).toBe(false);
      expect(nfeAutorizada(undefined)).toBe(false);
    });
  });
});
