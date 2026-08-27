import { NFeEngine } from '../src/NFeEngine';

const CONFIG = {
  pfxPath: '/tmp/test.pfx',
  pfxPassword: 'test',
  uf: 'MG',
  dbUrl: 'postgres://localhost/test',
  cnpjEmitente: '11222333000181',
  razaoSocial: 'TESTE',
  fantasia: '',
  ie: '1234567890',
  ambiente: '2' as const,
  crt: '1',
  endereco: {
    logradouro: 'RUA TESTE',
    numero: '100',
    bairro: 'CENTRO',
    codigoMunicipio: '3106200',
    nomeMunicipio: 'BELO HORIZONTE',
    cep: '30100000',
  },
  timeoutMs: 30000,
  maxRetries: 3,
};

describe('NFeEngine', () => {
  test('should throw if not initialized', () => {
    const engine = new NFeEngine(CONFIG);
    expect(() => (engine as any).ensureInitialized())
      .toThrow('nao inicializado');
  });

  test('should build NFe without initialization', () => {
    const engine = new NFeEngine(CONFIG);

    const nfe = engine.buildNFe({
      emitente: {
        cnpj: '11222333000181',
        razaoSocial: 'EMPRESA TESTE',
        fantasia: 'TESTE',
        endereco: {
          logradouro: 'RUA TESTE', numero: '100', bairro: 'CENTRO',
          codigoMunicipio: '3106200', nomeMunicipio: 'BELO HORIZONTE',
          uf: 'MG', cep: '30130000',
        },
        ie: '1234567890',
        crt: '1',
      },
      destinatario: {
        cnpj: '33645647000120',
        razaoSocial: 'CLIENTE',
        endereco: {
          logradouro: 'AV BRASIL', numero: '200', bairro: 'SAVASSI',
          codigoMunicipio: '3106200', nomeMunicipio: 'BELO HORIZONTE',
          uf: 'MG', cep: '30140071',
        },
        indIEDest: '9',
      },
      itens: [{
        codigo: '001', descricao: 'PRODUTO', ncm: '84715010',
        cfop: '5102', unidade: 'UN', quantidade: '1.0000',
        valorUnitario: '10.00',
        icms: { origem: '0', csosn: '102' },
        pis: { cst: '99' },
        cofins: { cst: '99' },
      }],
      pagamento: { formas: [{ tipo: '01', valor: '10.00' }] },
      serie: '1',
      numero: '1',
      naturezaOperacao: 'VENDA',
      dataEmissao: '2024-05-10T10:00:00-03:00',
      finalidade: '1',
      tipoOperacao: '1',
      destino: '1',
      presenca: '1',
      ambiente: '2',
      municipioFG: '3106200',
      ufEmitente: 'MG',
    });

    expect(nfe.emit.xNome).toBe('EMPRESA TESTE');
    expect(nfe.det).toHaveLength(1);
  });

  test('should validate XML without initialization', () => {
    const engine = new NFeEngine(CONFIG);
    const result = engine.validarXml('<nfe/>');
    expect(result.valid).toBe(false);
  });

  test('isContingencia should return false by default', () => {
    const engine = new NFeEngine(CONFIG);
    expect(engine.isContingencia()).toBe(false);
  });
});
