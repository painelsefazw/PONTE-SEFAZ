import { XsdValidator } from '../../src/infrastructure/validation/XsdValidator';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const VALID_XML = [
  '<infNFe versao="4.00" Id="NFe31240512345678000199550010000000011000000019">',
  '<ide><cUF>31</cUF><cNF>00000001</cNF><natOp>VENDA</natOp><mod>55</mod>',
  '<serie>1</serie><nNF>1</nNF><dhEmi>2024-05-10</dhEmi><tpNF>1</tpNF>',
  '<tpEmis>1</tpEmis><tpAmb>2</tpAmb></ide>',
  '<emit><CNPJ>12345678000199</CNPJ><xNome>TESTE</xNome>',
  '<enderEmit><xLgr>RUA</xLgr></enderEmit><IE>123</IE><CRT>1</CRT></emit>',
  '<dest><CNPJ>98765432000188</CNPJ><xNome>DEST</xNome></dest>',
  '<det nItem="1"><prod><xProd>PROD</xProd></prod></det>',
  '<total><ICMSTot><vNF>10.00</vNF></ICMSTot></total>',
  '<transp><modFrete>9</modFrete></transp>',
  '<pag><detPag><tPag>01</tPag></detPag></pag>',
  '</infNFe>',
].join('');

describe('XsdValidator', () => {
  test('isAvailable returns false when schemas dir does not exist', () => {
    const validator = new XsdValidator('/nonexistent/path');
    expect(validator.isAvailable()).toBe(false);
  });

  test('isAvailable returns false when dir exists but no xsd', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xsd-test-'));
    try {
      const validator = new XsdValidator(tmpDir);
      expect(validator.isAvailable()).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('isAvailable returns true when nfe_v4.00.xsd exists', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xsd-test-'));
    fs.writeFileSync(path.join(tmpDir, 'nfe_v4.00.xsd'), '<schema/>');
    try {
      const validator = new XsdValidator(tmpDir);
      expect(validator.isAvailable()).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('listSchemas returns xsd files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xsd-test-'));
    fs.writeFileSync(path.join(tmpDir, 'nfe_v4.00.xsd'), '<schema/>');
    fs.writeFileSync(path.join(tmpDir, 'tiposBasico_v4.00.xsd'), '<schema/>');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'ignore');
    try {
      const validator = new XsdValidator(tmpDir);
      const schemas = validator.listSchemas();
      expect(schemas).toEqual(['nfe_v4.00.xsd', 'tiposBasico_v4.00.xsd']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('validate returns valid for well-formed XML', () => {
    const validator = new XsdValidator('/nonexistent');
    const result = validator.validate(VALID_XML);
    expect(result.valid).toBe(true);
  });

  test('validate detects missing infNFe', () => {
    const validator = new XsdValidator('/nonexistent');
    const result = validator.validate('<nfe><ide/></nfe>');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('infNFe'))).toBe(true);
  });

  test('validate detects missing versao', () => {
    const validator = new XsdValidator('/nonexistent');
    const result = validator.validate('<infNFe><ide/><emit/><dest/><det/><total/><transp/><pag/></infNFe>');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('versao'))).toBe(true);
  });

  test('validate detects missing required elements', () => {
    const validator = new XsdValidator('/nonexistent');
    const result = validator.validate('<infNFe versao="4.00"><ide/></infNFe>');
    expect(result.valid).toBe(false);
    const missingElements = result.errors.filter(e => e.message.includes('obrigatorio'));
    expect(missingElements.length).toBeGreaterThan(0);
  });

  test('validate detects CNPJ with wrong length', () => {
    const validator = new XsdValidator('/nonexistent');
    const xml = VALID_XML.replace('<CNPJ>12345678000199</CNPJ>', '<CNPJ>123</CNPJ>');
    const result = validator.validate(xml);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('14 digitos'))).toBe(true);
  });

  test('validatePreFlight warns about missing signature', () => {
    const validator = new XsdValidator('/nonexistent');
    const result = validator.validatePreFlight(VALID_XML);
    expect(result.valid).toBe(true);
    expect(result.errors.some(e => e.message.includes('assinatura'))).toBe(true);
  });

  test('validatePreFlight passes with signature present', () => {
    const validator = new XsdValidator('/nonexistent');
    const xmlWithSig = VALID_XML + '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>';
    const result = validator.validatePreFlight(xmlWithSig);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
