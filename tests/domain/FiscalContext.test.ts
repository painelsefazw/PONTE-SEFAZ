import Decimal from 'decimal.js';
import { buildNFe, FiscalContextInput, UF_TO_IBGE } from '../../src/domain/FiscalContext';

function makeInput(overrides?: Partial<FiscalContextInput>): FiscalContextInput {
  return {
    emitente: {
      cnpj: '11222333000181',
      razaoSocial: 'EMPRESA TESTE LTDA',
      fantasia: 'TESTE',
      ie: '1234567890',
      crt: '1',
      endereco: {
        logradouro: 'RUA TESTE', numero: '100', bairro: 'CENTRO',
        codigoMunicipio: '3106200', nomeMunicipio: 'BELO HORIZONTE',
        uf: 'MG', cep: '30130000',
      },
    },
    destinatario: {
      cnpj: '33645647000120',
      razaoSocial: 'CLIENTE TESTE',
      indIEDest: '1',
      ie: '0987654321',
      endereco: {
        logradouro: 'AV BRASIL', numero: '200', bairro: 'SAVASSI',
        codigoMunicipio: '3106200', nomeMunicipio: 'BELO HORIZONTE',
        uf: 'MG', cep: '30140071',
      },
    },
    itens: [{
      codigo: '001', descricao: 'PRODUTO TESTE', ncm: '84715010',
      cfop: '5102', unidade: 'UN', quantidade: '2', valorUnitario: '10.00',
      icms: { origem: '0', csosn: '102' },
      pis: { cst: '99' },
      cofins: { cst: '99' },
    }],
    pagamento: { formas: [{ tipo: '01', valor: '20.00' }] },
    naturezaOperacao: 'VENDA',
    serie: '1',
    numero: '1',
    dataEmissao: '2024-05-10T10:00:00-03:00',
    finalidade: '1',
    tipoOperacao: '1',
    destino: '1',
    presenca: '1',
    ambiente: '2',
    municipioFG: '3106200',
    ufEmitente: 'MG',
    ...overrides,
  };
}

describe('FiscalContext - buildNFe', () => {
  test('should build a valid NFe object with all required sections', () => {
    const nfe = buildNFe(makeInput());
    expect(nfe.ide).toBeDefined();
    expect(nfe.emit).toBeDefined();
    expect(nfe.dest).toBeDefined();
    expect(nfe.det).toHaveLength(1);
    expect(nfe.total).toBeDefined();
    expect(nfe.transp).toBeDefined();
    expect(nfe.pag).toBeDefined();
  });

  test('should set cUF from ufEmitente using IBGE map', () => {
    const nfe = buildNFe(makeInput({ ufEmitente: 'SP' }));
    expect(nfe.ide.cUF).toBe('35');
  });

  test('should throw for unknown UF', () => {
    expect(() => buildNFe(makeInput({ ufEmitente: 'XX' }))).toThrow('Unknown UF');
  });

  test('should calculate vProd using Decimal.js (quantity * unitPrice)', () => {
    const nfe = buildNFe(makeInput());
    expect(nfe.det[0].prod.vProd).toBe('20.00');
    expect(nfe.total.ICMSTot.vProd).toBe('20.00');
    expect(nfe.total.ICMSTot.vNF).toBe('20.00');
  });

  test('should handle multiple items and sum totals', () => {
    const input = makeInput({
      itens: [
        { codigo: '001', descricao: 'A', ncm: '84715010', cfop: '5102', unidade: 'UN', quantidade: '3', valorUnitario: '10.50', icms: { origem: '0', csosn: '102' }, pis: { cst: '99' }, cofins: { cst: '99' } },
        { codigo: '002', descricao: 'B', ncm: '84715010', cfop: '5102', unidade: 'UN', quantidade: '1', valorUnitario: '5.25', icms: { origem: '0', csosn: '102' }, pis: { cst: '99' }, cofins: { cst: '99' } },
      ],
      pagamento: { formas: [{ tipo: '01', valor: '36.75' }] },
    });
    const nfe = buildNFe(input);
    expect(nfe.det).toHaveLength(2);
    expect(nfe.det[0].nItem).toBe('1');
    expect(nfe.det[1].nItem).toBe('2');
    expect(nfe.det[0].prod.vProd).toBe('31.50');
    expect(nfe.det[1].prod.vProd).toBe('5.25');
    expect(nfe.total.ICMSTot.vProd).toBe('36.75');
  });

  test('should build ICMS00 for CST 00', () => {
    const input = makeInput({
      // CST de ICMS so existe em regime normal. A fixture usava CRT 1 (Simples)
      // com CST 00, combinacao que a SEFAZ recusa — o teste passava porque o
      // motor aceitava calado.
      emitente: { ...makeInput().emitente, crt: '3' },
      itens: [{
        codigo: '001', descricao: 'P', ncm: '84715010', cfop: '5102', unidade: 'UN',
        quantidade: '1', valorUnitario: '10.00',
        icms: { origem: '0', cst: '00', modBC: '3', vBC: '10.00', pICMS: '18.00', vICMS: '1.80' },
        pis: { cst: '01', aliquota: '1.65' },
        cofins: { cst: '01', aliquota: '7.60' },
      }],
    });
    const nfe = buildNFe(input);
    const icms = nfe.det[0].imposto.ICMS!;
    expect('ICMS00' in icms).toBe(true);
    if ('ICMS00' in icms) {
      expect(icms.ICMS00.CST).toBe('00');
      expect(icms.ICMS00.vICMS).toBe('1.80');
    }
    expect(nfe.total.ICMSTot.vBC).toBe('10.00');
    expect(nfe.total.ICMSTot.vICMS).toBe('1.80');
  });

  test('should build ICMS40 for CST 40/41/50', () => {
    const input = makeInput({
      // CST de ICMS so existe em regime normal. A fixture usava CRT 1 (Simples)
      // com CST 00, combinacao que a SEFAZ recusa — o teste passava porque o
      // motor aceitava calado.
      emitente: { ...makeInput().emitente, crt: '3' },
      itens: [{
        codigo: '001', descricao: 'P', ncm: '84715010', cfop: '5102', unidade: 'UN',
        quantidade: '1', valorUnitario: '10.00',
        icms: { origem: '0', cst: '41' },
        pis: { cst: '99' }, cofins: { cst: '99' },
      }],
    });
    const nfe = buildNFe(input);
    const icms = nfe.det[0].imposto.ICMS!;
    expect('ICMS40' in icms).toBe(true);
  });

  test('should calculate PIS and COFINS for aliquot CSTs', () => {
    const input = makeInput({
      itens: [{
        codigo: '001', descricao: 'P', ncm: '84715010', cfop: '5102', unidade: 'UN',
        quantidade: '1', valorUnitario: '10.00',
        icms: { origem: '0', csosn: '102' },
        pis: { cst: '01', aliquota: '1.65' },
        cofins: { cst: '01', aliquota: '7.60' },
      }],
    });
    const nfe = buildNFe(input);
    const pis = nfe.det[0].imposto.PIS!;
    expect('PISAliq' in pis).toBe(true);
    if ('PISAliq' in pis) {
      expect(pis.PISAliq.vPIS).toBe('0.17');
    }
    expect(nfe.total.ICMSTot.vPIS).toBe('0.17');
  });

  test('should set modFrete default to 9 (sem frete)', () => {
    const nfe = buildNFe(makeInput());
    expect(nfe.transp.modFrete).toBe('9');
  });

  test('should include informacoesAdicionais when provided', () => {
    const nfe = buildNFe(makeInput({
      informacoesAdicionais: { fisco: 'INFO FISCO', complementar: 'COMPLEMENTO' },
    }));
    expect(nfe.infAdic).toBeDefined();
    expect(nfe.infAdic!.infAdFisco).toBe('INFO FISCO');
    // O texto do usuario vem primeiro e inteiro; o demonstrativo da Reforma e
    // anexado depois (ver teste dedicado abaixo).
    expect(nfe.infAdic!.infCpl).toMatch(/^COMPLEMENTO\b/);
  });

  describe('demonstrativo IBS/CBS nas informacoes complementares', () => {
    test('anexa o demonstrativo mesmo sem texto do usuario', () => {
      const nfe = buildNFe(makeInput());
      const infCpl = nfe.infAdic!.infCpl!;
      expect(infCpl).toContain('Reforma Tributaria');
      expect(infCpl).toContain(`IBS R$ ${nfe.total.IBSCBSTot!.gIBS.vIBS.replace('.', ',')}`);
      expect(infCpl).toContain(`CBS R$ ${nfe.total.IBSCBSTot!.gCBS.vCBS.replace('.', ',')}`);
    });

    test('preserva o texto do usuario antes do demonstrativo', () => {
      const nfe = buildNFe(makeInput({
        informacoesAdicionais: { complementar: 'PEDIDO 4471' },
      }));
      expect(nfe.infAdic!.infCpl).toMatch(/^PEDIDO 4471 \| Reforma Tributaria/);
    });

    test('a aliquota impressa e a efetiva, derivada dos valores apurados', () => {
      const nfe = buildNFe(makeInput());
      // 2026: IBS 0,1% (UF) + 0% (Mun) e CBS 0,9%.
      expect(nfe.infAdic!.infCpl).toContain('(0,10%)');
      expect(nfe.infAdic!.infCpl).toContain('(0,90%)');
    });

    test('respeita o limite de 5000 e preserva o demonstrativo', () => {
      const nfe = buildNFe(makeInput({
        informacoesAdicionais: { complementar: 'X'.repeat(6000) },
      }));
      const infCpl = nfe.infAdic!.infCpl!;
      expect(infCpl.length).toBeLessThanOrEqual(5000);
      expect(infCpl).toContain('Reforma Tributaria');
      expect(infCpl).toContain('Total IBS+CBS');
    });

    test('o valor impresso e o mesmo do XML', () => {
      const nfe = buildNFe(makeInput());
      const somaXml = new Decimal(nfe.total.IBSCBSTot!.gIBS.vIBS)
        .plus(nfe.total.IBSCBSTot!.gCBS.vCBS).toFixed(2);
      expect(nfe.infAdic!.infCpl).toContain(`Total IBS+CBS R$ ${somaXml.replace('.', ',')}`);
    });
  });

  test('should default zeroed totals for non-applicable fields', () => {
    const nfe = buildNFe(makeInput());
    const tot = nfe.total.ICMSTot;
    expect(tot.vBCST).toBe('0.00');
    expect(tot.vST).toBe('0.00');
    expect(tot.vII).toBe('0.00');
    expect(tot.vIPI).toBe('0.00');
    expect(tot.vFrete).toBe('0.00');
    expect(tot.vSeg).toBe('0.00');
    expect(tot.vDesc).toBe('0.00');
    expect(tot.vOutro).toBe('0.00');
  });
});

describe('FiscalContext - DIFAL (ICMSUFDest, EC 87/2015)', () => {
  function difalInput(overrides?: Partial<FiscalContextInput>): FiscalContextInput {
    return makeInput({
      destino: '2',
      indFinal: '1',
      // DIFAL com CST 00 pressupoe regime normal; no Simples o codigo seria
      // CSOSN e o grupo de ICMS, outro.
      emitente: { ...makeInput().emitente, crt: '3' },
      destinatario: {
        cpf: '12345678909',
        razaoSocial: 'CONSUMIDOR FINAL SP',
        indIEDest: '9',
        endereco: {
          logradouro: 'AV PAULISTA', numero: '1000', bairro: 'BELA VISTA',
          codigoMunicipio: '3550308', nomeMunicipio: 'SAO PAULO',
          uf: 'SP', cep: '01310100',
        },
      },
      itens: [{
        codigo: '001', descricao: 'PRODUTO TESTE', ncm: '84715010',
        cfop: '6108', unidade: 'UN', quantidade: '2', valorUnitario: '10.00',
        icms: { origem: '0', cst: '00', modBC: '3', vBC: '20.00', pICMS: '18.00', vICMS: '3.60' },
        pis: { cst: '99' },
        cofins: { cst: '99' },
      }],
      pICMSUFDest: '18',
      ...overrides,
    });
  }

  test('should build ICMSUFDest for interestadual + consumidor final + nao contribuinte', () => {
    const nfe = buildNFe(difalInput());
    const difal = nfe.det[0].imposto.ICMSUFDest;
    expect(difal).toBeDefined();
    expect(difal!.vBCUFDest).toBe('20.00');
    expect(difal!.pICMSUFDest).toBe('18.00');
    expect(difal!.pICMSInter).toBe('12.00'); // MG -> SP: Sul/Sudeste
    expect(difal!.pICMSInterPart).toBe('100.00');
    // vICMSUFDest = 20.00 * (18 - 12)% * 100% = 1.20
    expect(difal!.vICMSUFDest).toBe('1.20');
    expect(difal!.vICMSUFRemet).toBe('0.00');
    expect(nfe.total.ICMSTot.vICMSUFDest).toBe('1.20');
    expect(nfe.total.ICMSTot.vICMSUFRemet).toBe('0.00');
  });

  test('should use 7% interstate rate for MG -> BA (Sul/Sudeste -> Nordeste)', () => {
    const input = difalInput();
    input.destinatario.endereco.uf = 'BA';
    input.destinatario.endereco.codigoMunicipio = '2927408';
    input.destinatario.endereco.nomeMunicipio = 'SALVADOR';
    // O CEP tambem muda de estado. A fixture trocava so a UF e mantinha o CEP
    // de Sao Paulo — exatamente o cadastro copiado de outro cliente que a
    // conferencia de faixa existe para pegar.
    input.destinatario.endereco.cep = '40020000';
    const nfe = buildNFe(input);
    expect(nfe.det[0].imposto.ICMSUFDest!.pICMSInter).toBe('7.00');
    // vICMSUFDest = 20.00 * (18 - 7)% = 2.20
    expect(nfe.det[0].imposto.ICMSUFDest!.vICMSUFDest).toBe('2.20');
  });

  test('should use 4% interstate rate for imported goods (orig 1)', () => {
    const input = difalInput();
    input.itens[0].icms.origem = '1';
    const nfe = buildNFe(input);
    expect(nfe.det[0].imposto.ICMSUFDest!.pICMSInter).toBe('4.00');
  });

  test('should NOT build ICMSUFDest for contribuinte (indIEDest 1)', () => {
    const input = difalInput();
    input.destinatario.indIEDest = '1';
    input.destinatario.ie = '110042490114';
    const nfe = buildNFe(input);
    expect(nfe.det[0].imposto.ICMSUFDest).toBeUndefined();
    expect(nfe.total.ICMSTot.vICMSUFDest).toBeUndefined();
  });

  test('should NOT build ICMSUFDest for isento (indIEDest 2)', () => {
    const input = difalInput();
    input.destinatario.indIEDest = '2';
    const nfe = buildNFe(input);
    expect(nfe.det[0].imposto.ICMSUFDest).toBeUndefined();
  });

  test('should NOT build ICMSUFDest for operacao interna (destino 1)', () => {
    const nfe = buildNFe(difalInput({ destino: '1' }));
    expect(nfe.det[0].imposto.ICMSUFDest).toBeUndefined();
  });

  test('should NOT build ICMSUFDest when nao consumidor final (indFinal 0)', () => {
    const nfe = buildNFe(difalInput({ indFinal: '0' }));
    expect(nfe.det[0].imposto.ICMSUFDest).toBeUndefined();
  });
});

describe('FiscalContext - NF-e de entrada (tpNF 0)', () => {
  test('should build entrada note with tpNF 0 and CFOP 1102', () => {
    const input = makeInput({ tipoOperacao: '0', indFinal: '0' });
    input.itens[0].cfop = '1102';
    const nfe = buildNFe(input);
    expect(nfe.ide.tpNF).toBe('0');
    expect(nfe.ide.indFinal).toBe('0');
    expect(nfe.det[0].prod.CFOP).toBe('1102');
  });

  test('should support tPag 90 (sem pagamento) with vPag 0.00', () => {
    const input = makeInput({
      tipoOperacao: '0',
      pagamento: { formas: [{ tipo: '90', valor: '0.00' }] },
    });
    const nfe = buildNFe(input);
    expect(nfe.pag.detPag[0].tPag).toBe('90');
    expect(nfe.pag.detPag[0].vPag).toBe('0.00');
  });

  test('should NOT build DIFAL for entrada even when interestadual', () => {
    const input = makeInput({
      tipoOperacao: '0',
      destino: '2',
      indFinal: '0',
    });
    const nfe = buildNFe(input);
    expect(nfe.det[0].imposto.ICMSUFDest).toBeUndefined();
  });
});

describe('UF_TO_IBGE', () => {
  test('should have all 27 Brazilian states', () => {
    expect(Object.keys(UF_TO_IBGE)).toHaveLength(27);
  });

  test('should map known states correctly', () => {
    expect(UF_TO_IBGE['MG']).toBe('31');
    expect(UF_TO_IBGE['SP']).toBe('35');
    expect(UF_TO_IBGE['RJ']).toBe('33');
    expect(UF_TO_IBGE['DF']).toBe('53');
    expect(UF_TO_IBGE['AM']).toBe('13');
  });
});
