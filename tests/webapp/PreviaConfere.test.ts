import * as path from 'path';
import { XsdValidator } from '../../src/infrastructure/validation/XsdValidator';
import { querSimular } from '../../src/webapp/app';
import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';
import { XmlGenerator } from '../../src/infrastructure/xml/XmlGenerator';

/**
 * A prévia tem de reprovar o que a SEFAZ reprovaria.
 *
 * Enquanto a "validação XSD" era uma sequência de `xml.includes('<dest')`, ela
 * dava verde em qualquer coisa: CEP com hífen, UF minúscula, nota sem nenhum
 * item. A rejeição vinha da SEFAZ como cStat 225 — que não diz o campo — depois
 * de a nota já ter sido montada e assinada. Uma prévia que aprova o que será
 * recusado é pior que prévia nenhuma, porque ensina a confiar.
 *
 * O outro caso aqui é mais grave que qualquer rejeição: `simular: "true"`, a
 * forma que sai de qualquer formulário, não era reconhecida — e quem pedia
 * prévia recebia nota fiscal autorizada.
 */

const SCHEMAS = path.join(__dirname, '../../schemas');
const CHAVE = '35260850229544000106558000000000421234567890';

function entrada(over: { cep?: string; uf?: string; semItens?: boolean } = {}): FiscalContextInput {
  return {
    emitente: {
      cnpj: '50229544000106', razaoSocial: 'EMPRESA TESTE LTDA',
      ie: '454941321110', crt: '1',
      endereco: {
        logradouro: 'RUA A', numero: '1', bairro: 'CENTRO', codigoMunicipio: '3530607',
        nomeMunicipio: 'MOGI DAS CRUZES', uf: 'SP', cep: '08810240',
      },
    },
    destinatario: {
      cnpj: '33645647000120', razaoSocial: 'CLIENTE LTDA',
      indIEDest: '1', ie: '454635504116',
      endereco: {
        logradouro: 'RUA B', numero: '2', bairro: 'CENTRO', codigoMunicipio: '3530607',
        nomeMunicipio: 'MOGI DAS CRUZES', uf: over.uf ?? 'SP',
        cep: over.cep ?? '08810240',
      },
    },
    itens: over.semItens ? [] : [{
      codigo: '682700', descricao: 'CANETA DE BISTURI ELETRICA', ncm: '90189029',
      cfop: '5102', unidade: 'UN', quantidade: '2', valorUnitario: '1265.00',
      icms: { origem: '0', csosn: '102' }, pis: { cst: '99' }, cofins: { cst: '99' },
    }],
    pagamento: { formas: [{ tipo: '01', valor: '2530.00' }] },
    naturezaOperacao: 'VENDA DE MERCADORIA', serie: '800', numero: '42',
    dataEmissao: '2026-08-03T10:00:00-03:00', finalidade: '1', tipoOperacao: '1',
    destino: '1', indFinal: '1', presenca: '1', ambiente: '2',
    municipioFG: '3530607', ufEmitente: 'SP', modFrete: '9',
  } as FiscalContextInput;
}

const xmlDe = (over = {}) => new XmlGenerator().generateInfNFe(buildNFe(entrada(over)), CHAVE);

describe('a previa confere de verdade', () => {
  const validador = new XsdValidator(SCHEMAS);

  it('os schemas estao disponiveis no projeto', () => {
    expect(validador.isAvailable()).toBe(true);
  });

  it('nota correta passa — nao pode haver falso reprovado', async () => {
    const r = await validador.validarSchema(xmlDe());
    expect(r.disponivel).toBe(true);
    expect(r.errors.map(e => e.message)).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it('CEP com hifen NAO chega mais ao schema — e corrigido antes', async () => {
    // Este caso ja provou que o validador confere de verdade. Hoje ele prova
    // outra coisa: a pontuacao do CEP e removida na montagem, entao o XML que
    // chega ao schema ja esta limpo. E correcao automatica segura — a tela
    // sempre fez esse `replace`, e quem entrava pela API e que nao tinha a rede.
    const r = await validador.validarSchema(xmlDe({ cep: '08810-240' }));
    expect(r.valid).toBe(true);
  });

  it('CEP com digito a menos nem chega a virar XML', () => {
    // Tirar a pontuacao nao inventa digito. O que mudou e ONDE isso e pego:
    // antes so o schema reclamava, com um erro de facet; agora a montagem
    // recusa nomeando o campo, o dono do endereco e quantos digitos vieram.
    expect(() => xmlDe({ cep: '881024' }))
      .toThrow(/CEP_INVALIDO: \(destinatário\) o CEP "881024" tem 6 dígito\(s\)/);
  });

  it('UF minuscula e reprovada — a enumeracao so tem maiusculas', async () => {
    const r = await validador.validarSchema(xmlDe({ uf: 'sp' }));
    expect(r.valid).toBe(false);
  });

  it('falha aberta: sem os schemas, nao reprova — so avisa que nao conferiu', async () => {
    const semSchemas = new XsdValidator(path.join(__dirname, 'pasta-que-nao-existe'));
    const r = await semSchemas.validarSchema(xmlDe());
    expect(r.disponivel).toBe(false);
    expect(r.valid).toBe(true);
  });
});

describe('conferencia de presenca de campo', () => {
  const validador = new XsdValidator(SCHEMAS);

  it('nota SEM NENHUM ITEM e reprovada — antes <det casava com <detPag>', () => {
    const semItens = xmlDe({ semItens: true });
    expect(semItens).toContain('<detPag');
    expect(semItens).not.toMatch(/<det[ >]/);

    const r = validador.validate(semItens);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.message.includes('<det>'))).toBe(true);
  });

  it('nota com item passa', () => {
    expect(validador.validate(xmlDe()).valid).toBe(true);
  });
});

describe('quem pediu previa recebe previa', () => {
  it.each([true, 1, '1', 'true', 'TRUE', ' true ', 'sim', 's', 'yes'])(
    '%p pede simulacao',
    (v) => expect(querSimular(v)).toBe(true),
  );

  it.each([false, 0, '0', 'false', 'nao', '', null, undefined, 'emitir'])(
    '%p NAO pede simulacao',
    (v) => expect(querSimular(v)).toBe(false),
  );

  it('"true" como string era o caso que emitia de verdade', () => {
    expect(querSimular('true')).toBe(true);
  });
});
