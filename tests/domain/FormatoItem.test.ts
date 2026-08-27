import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';

/**
 * Formatos de tamanho fixo do item.
 *
 * A SEFAZ recusa formato errado com cStat 225 — "Falha no Schema XML do lote de
 * NFe" — e não diz qual campo nem qual item. Aconteceu em produção com um NCM
 * de 7 dígitos, copiado de um código de subposição ("9018.90.2") em vez do
 * código completo.
 *
 * O ganho aqui não é impedir a rejeição: é dizer o que está errado e onde,
 * antes de gastar a ida à SEFAZ.
 */

function contexto(over: Partial<FiscalContextItem> = {}): FiscalContextInput {
  return {
    emitente: {
      cnpj: '34051105000191',
      razaoSocial: 'EMITENTE LTDA',
      ie: '111111111111',
      crt: '1',
      endereco: {
        logradouro: 'RUA A', numero: '1', bairro: 'CENTRO',
        codigoMunicipio: '3530607', nomeMunicipio: 'MOGI DAS CRUZES',
        uf: 'SP', cep: '08710000',
      },
    },
    destinatario: {
      cnpj: '33645647000120',
      razaoSocial: 'CLIENTE LTDA',
      indIEDest: '9',
      endereco: {
        logradouro: 'RUA B', numero: '2', bairro: 'CENTRO',
        codigoMunicipio: '3530607', nomeMunicipio: 'MOGI DAS CRUZES',
        uf: 'SP', cep: '08810240',
      },
    },
    itens: [{
      codigo: '001',
      descricao: 'PLACA DE GESSO',
      ncm: '68091100',
      cfop: '5102',
      unidade: 'UN',
      quantidade: '1',
      valorUnitario: '100.00',
      // A fixture guardava CSOSN 102 no campo `cst` — a coluna trocada, que e
      // justamente o defeito que o motor passou a recusar. Passava antes porque
      // o default de buildICMS empurrava qualquer codigo desconhecido para
      // dentro do grupo do Simples.
      icms: { csosn: '102', origem: '0' },
      pis: { cst: '99' },
      cofins: { cst: '99' },
      ...over,
    }] as any,
    pagamento: { formas: [{ tipo: '01', valor: '100.00' }] },
    serie: '1',
    numero: '1',
    naturezaOperacao: 'VENDA',
    dataEmissao: '2026-07-30T10:00:00-03:00',
    ufEmitente: 'SP',
    ambiente: '2',
  } as any;
}

type FiscalContextItem = FiscalContextInput['itens'][number];

const gerar = (over?: Partial<FiscalContextItem>) => buildNFe(contexto(over));

describe('NCM do item', () => {
  test('aceita os 8 digitos', () => {
    expect(() => gerar()).not.toThrow();
    expect(gerar().det[0].prod.NCM).toBe('68091100');
  });

  // O XSD é [0-9]{2}|[0-9]{8}: dois dígitos valem quando a operação dispensa o
  // detalhamento.
  test('aceita os 2 digitos do NCM generico', () => {
    expect(() => gerar({ ncm: '68' })).not.toThrow();
  });

  // O caso real: código de subposição copiado sem o último par.
  test('recusa 7 digitos e explica o que houve', () => {
    expect(() => gerar({ ncm: '9018902' })).toThrow(/NCM_INVALIDO/);
    expect(() => gerar({ ncm: '9018902' })).toThrow(/7 dígito/);
    expect(() => gerar({ ncm: '9018902' })).toThrow(/subposição/);
  });

  // A mensagem tem que dizer QUAL item: numa nota de dez produtos, "falha no
  // schema" sem posição não ajuda.
  test('a mensagem aponta o item pelo numero e pela descricao', () => {
    expect(() => gerar({ ncm: '123', descricao: 'CANETA' })).toThrow(/item 1/);
    expect(() => gerar({ ncm: '123', descricao: 'CANETA' })).toThrow(/CANETA/);
  });

  test('recusa vazio e nao-numerico', () => {
    expect(() => gerar({ ncm: '' })).toThrow(/NCM_INVALIDO/);
    expect(() => gerar({ ncm: 'abcdefgh' })).toThrow(/NCM_INVALIDO/);
  });

  // A validação já ignorava a pontuação, mas o valor ia cru para o XML — e o
  // ponto quebrava o schema igual.
  test('a pontuacao e removida antes de ir para o XML', () => {
    expect(() => gerar({ ncm: '9018.90.29' })).not.toThrow();
    expect(gerar({ ncm: '9018.90.29' }).det[0].prod.NCM).toBe('90189029');
    expect(gerar({ cfop: '5.102' }).det[0].prod.CFOP).toBe('5102');
    expect(gerar({ cest: '28.104.00' }).det[0].prod.CEST).toBe('2810400');
  });
});

describe('CFOP do item', () => {
  test('aceita os 4 digitos', () => {
    expect(() => gerar({ cfop: '6102' })).not.toThrow();
  });

  test('recusa tamanho diferente', () => {
    expect(() => gerar({ cfop: '510' })).toThrow(/CFOP_INVALIDO/);
    expect(() => gerar({ cfop: '51020' })).toThrow(/CFOP_INVALIDO/);
  });
});

/**
 * Limites de texto do leiaute.
 *
 * Uma razão social de 68 caracteres impedia a empresa de emitir **qualquer**
 * nota: a SEFAZ recusava com cStat 225 sem dizer o campo. O máximo de `xNome` é
 * 60. Acima disso não existe nota possível, então truncar é a única saída —
 * recusar deixaria a empresa parada, e o nome completo continua no cadastro e
 * no DANFE, que não têm essa restrição.
 */
describe('limites de texto do cadastro', () => {
  const nomeLongo = 'SIMIVALE DISTRIBUIDORA DE MATERIAIS E MEDICAMENTOS HOSPITALARES LTDA';

  test('o caso real tinha 68 caracteres', () => {
    expect(nomeLongo.length).toBe(68);
  });

  test('razao social do emitente e cortada em 60', () => {
    const ctx = contexto();
    ctx.emitente.razaoSocial = nomeLongo;
    const nfe = buildNFe(ctx);
    expect(nfe.emit.xNome).toHaveLength(60);
    expect(nomeLongo.startsWith(nfe.emit.xNome)).toBe(true);
  });

  test('razao social do destinatario tambem', () => {
    const ctx = contexto();
    ctx.destinatario.razaoSocial = nomeLongo;
    expect(buildNFe(ctx).dest.xNome).toHaveLength(60);
  });

  test('nome dentro do limite passa intacto', () => {
    const ctx = contexto();
    ctx.emitente.razaoSocial = 'EMPRESA CURTA LTDA';
    expect(buildNFe(ctx).emit.xNome).toBe('EMPRESA CURTA LTDA');
  });

  test('endereco e natureza da operacao respeitam 60', () => {
    const ctx = contexto();
    ctx.emitente.endereco.logradouro = 'R'.repeat(80);
    ctx.emitente.endereco.bairro = 'B'.repeat(70);
    ctx.naturezaOperacao = 'N'.repeat(90);
    const nfe = buildNFe(ctx);
    expect(nfe.emit.enderEmit.xLgr).toHaveLength(60);
    expect(nfe.emit.enderEmit.xBairro).toHaveLength(60);
    expect(nfe.ide.natOp).toHaveLength(60);
  });

  // Curto demais nao tem conserto automatico: recusa dizendo o campo.
  test('texto abaixo do minimo e recusado', () => {
    const ctx = contexto();
    ctx.destinatario.endereco.bairro = 'C';
    expect(() => buildNFe(ctx)).toThrow(/TEXTO_CURTO/);
    expect(() => buildNFe(ctx)).toThrow(/bairro/);
  });

  test('dois caracteres ja passam', () => {
    const ctx = contexto();
    ctx.destinatario.endereco.bairro = 'SP';
    expect(() => buildNFe(ctx)).not.toThrow();
  });

  // xProd tem limite maior que os demais: 120.
  test('descricao do produto vai ate 120', () => {
    const ctx = contexto();
    (ctx.itens[0] as any).descricao = 'P'.repeat(150);
    expect(buildNFe(ctx).det[0].prod.xProd).toHaveLength(120);
  });
});

/**
 * Número do endereço.
 *
 * `nro` é obrigatório. Vazio fazia o elemento sumir do XML, e o schema
 * rejeitava com cStat 225 apontando o campo seguinte — "xBairro não é
 * esperado, esperado nro". Foi o que travou a emissão em produção, e só
 * apareceu ao ler o XML gerado: o endereço ia de `xLgr` direto para `xBairro`.
 */
describe('numero do endereco', () => {
  test('vazio vira S/N em vez de sumir do XML', () => {
    const ctx = contexto();
    ctx.destinatario.endereco.numero = '';
    expect(buildNFe(ctx).dest.enderDest.nro).toBe('S/N');
  });

  test('so espacos tambem', () => {
    const ctx = contexto();
    ctx.emitente.endereco.numero = '   ';
    expect(buildNFe(ctx).emit.enderEmit.nro).toBe('S/N');
  });

  test('numero informado passa intacto', () => {
    const ctx = contexto();
    ctx.destinatario.endereco.numero = '174';
    expect(buildNFe(ctx).dest.enderDest.nro).toBe('174');
  });
});

describe('CEST do item', () => {
  test('opcional: ausente nao e erro', () => {
    expect(() => gerar({ cest: undefined })).not.toThrow();
    expect(() => gerar({ cest: '' })).not.toThrow();
  });

  test('quando informado, tem 7 digitos', () => {
    expect(() => gerar({ cest: '2810400' })).not.toThrow();
    expect(() => gerar({ cest: '281040' })).toThrow(/CEST_INVALIDO/);
  });
});
