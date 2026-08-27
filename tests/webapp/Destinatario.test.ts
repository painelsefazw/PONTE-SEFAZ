import { erroDoDestinatario } from '../../src/webapp/app';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Conferencia do destinatario antes de transmitir.
 *
 * Os quatro casos abaixo tem a mesma forma: o dado necessario para decidir ja
 * esta na requisicao, o XSD aceita, a previa fica verde — e quem recusa e a
 * regra de negocio da SEFAZ, depois de a nota ter sido montada, assinada e
 * transmitida. Conferir aqui troca uma ida a SEFAZ por uma frase que diz o que
 * corrigir.
 */

const base = {
  cnpj: '33645647000120',
  razaoSocial: 'CLIENTE LTDA',
  indIEDest: '9',
  endereco: { uf: 'SP', codigoMunicipio: '3530607' },
};

const dest = (mudanca: Record<string, unknown>) => ({ ...base, ...mudanca });
const comEndereco = (endereco: Record<string, unknown>) =>
  ({ ...base, endereco: { ...base.endereco, ...endereco } });

describe('UF', () => {
  test('minuscula nao e recusada aqui — esta funcao normaliza para conferir', () => {
    expect(erroDoDestinatario(comEndereco({ uf: 'sp' }))).toBeUndefined();
    expect(erroDoDestinatario(comEndereco({ uf: ' SP ' }))).toBeUndefined();
  });

  test('a rota normaliza a UF ANTES de calcular o destino', () => {
    // Normalizar so para conferir nao basta, e normalizar depois e pior que
    // nao normalizar: o XML sai bonito e a DIRECAO sai errada. `calcularDestino`
    // decide interna x interestadual, e dele saem o CFOP reescrito (5102 -> 6102)
    // e o DIFAL. Na primeira versao desta correcao a normalizacao ficou 40 linhas
    // ABAIXO do calculo, entao a conferencia passava e a direcao continuava
    // decidida pelo 'mg' cru.
    //
    // Como a mutacao acontece dentro do handler autenticado, o que da para
    // travar sem subir a rota inteira e a ordem no arquivo.
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8',
    );
    const normaliza = fonte.search(
      /body\.destinatario\.endereco\.uf\s*=\s*String\(body\.destinatario\.endereco\.uf\)\.trim\(\)\.toUpperCase\(\)/,
    );
    const confere = fonte.indexOf('conferirDestinatario(body.destinatario, res)');
    const calcula = fonte.indexOf('calcularDestino(emp.uf, ufDest)');

    expect(normaliza).toBeGreaterThan(-1);
    expect(confere).toBeGreaterThan(normaliza);
    expect(calcula).toBeGreaterThan(confere);
  });

  test('a rota nao deduz mais a UF do destinatario a partir do emitente', () => {
    // `ufDest = ... || emp.uf` era a deducao silenciosa. Se voltar, os testes
    // desta funcao continuam verdes — a recusa nunca chegaria a ser consultada,
    // porque o campo ja teria sido preenchido antes.
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8',
    );
    expect(fonte).not.toMatch(/ufDest\s*=\s*body\.destinatario[^\n]*\|\|\s*emp\.uf/);
  });

  test('sigla que nao existe e recusada dizendo qual foi', () => {
    const erro = erroDoDestinatario(comEndereco({ uf: 'XX', codigoMunicipio: '' }));
    expect(erro).toMatch(/UF do destinatario invalida: "XX"/);
  });

  test('nome do estado por extenso e recusado como UF invalida', () => {
    // O erro real: cadastro guarda "Minas Gerais" e alguem manda o campo
    // inteiro. Como texto parece certo; para a SEFAZ nao e sigla.
    expect(erroDoDestinatario(comEndereco({ uf: 'Minas Gerais', codigoMunicipio: '' })))
      .toMatch(/UF do destinatario invalida/);
  });

  test('EX passa — exportacao nao tem UF brasileira', () => {
    expect(erroDoDestinatario(comEndereco({ uf: 'EX', codigoMunicipio: '' }))).toBeUndefined();
  });

  test('UF ausente e recusada em vez de virar a do emitente', () => {
    // O `|| emp.uf` transformava venda sem UF em operacao interna: CFOP forcado
    // para 5xxx e DIFAL desligado. O XML saia com <UF> vazia e quem reclamava
    // era o schema da SEFAZ, com uma falha que nao nomeia o campo.
    expect(erroDoDestinatario(comEndereco({ uf: '', codigoMunicipio: '' })))
      .toMatch(/UF do destinatario ausente/);
  });

  test('a recusa explica por que a UF nao da para deduzir', () => {
    // Sem isto parece burocracia. A UF e o que separa 5102 de 6102.
    const erro = erroDoDestinatario(comEndereco({ uf: '', codigoMunicipio: '' }));
    expect(erro).toMatch(/5xxx/);
    expect(erro).toMatch(/6xxx/);
  });

  test('so em branco tambem conta como ausente', () => {
    expect(erroDoDestinatario(comEndereco({ uf: '   ', codigoMunicipio: '' })))
      .toMatch(/UF do destinatario ausente/);
  });
});

describe('IE x indIEDest', () => {
  test('contribuinte sem IE e recusado antes de ir para a SEFAZ', () => {
    const erro = erroDoDestinatario(dest({ indIEDest: '1', ie: '' }));
    expect(erro).toMatch(/indIEDest 1.*sem Inscricao Estadual/s);
  });

  test('a recusa diz as duas saidas, nao so o problema', () => {
    // Sem isto o operador so sabe que errou; com isto ele sabe se o caso dele e
    // isento (2) ou consumidor final (9).
    const erro = erroDoDestinatario(dest({ indIEDest: '1', ie: '' }));
    expect(erro).toMatch(/indIEDest 2/);
    expect(erro).toMatch(/indIEDest 9/);
  });

  test('a palavra ISENTO na IE nao conta como inscricao', () => {
    // O caso mais comum de todos: o ERP grava "ISENTO" na coluna da IE. Como
    // texto ela parece preenchida — checar so `if (ie)` deixaria passar, e a
    // SEFAZ recusaria com 728 pedindo um campo que a tela mostra cheio.
    const erro = erroDoDestinatario(dest({ indIEDest: '1', ie: 'ISENTO' }));
    expect(erro).toMatch(/nao tem digitos/);
  });

  test('contribuinte com IE passa', () => {
    expect(erroDoDestinatario(dest({ indIEDest: '1', ie: '454635504116' }))).toBeUndefined();
  });

  test('nao contribuinte COM IE tambem e recusado', () => {
    const erro = erroDoDestinatario(dest({ indIEDest: '9', ie: '454635504116' }));
    expect(erro).toMatch(/NAO contribuinte \(indIEDest 9\)/);
  });

  test('nao contribuinte com "ISENTO" no campo passa', () => {
    // Aqui o texto sem digitos e inofensivo: nao ha inscricao, que e o que o
    // indIEDest 9 afirma. Recusar seria barrar venda legitima a consumidor.
    expect(erroDoDestinatario(dest({ indIEDest: '9', ie: 'ISENTO' }))).toBeUndefined();
  });

  test('isento (2) nao e conferido nos dois sentidos', () => {
    // O indIEDest 2 e o unico que aceita os dois estados do campo.
    expect(erroDoDestinatario(dest({ indIEDest: '2', ie: '' }))).toBeUndefined();
    expect(erroDoDestinatario(dest({ indIEDest: '2', ie: 'ISENTO' }))).toBeUndefined();
  });
});

describe('UF x codigo IBGE', () => {
  test('municipio de outro estado e recusado', () => {
    // 3530607 e Mogi das Cruzes/SP. Numa nota com UF MG, a SEFAZ recusa — e o
    // operador olha o NOME do municipio, que esta certo, sem achar o erro.
    const erro = erroDoDestinatario(comEndereco({ uf: 'MG', codigoMunicipio: '3530607' }));
    expect(erro).toMatch(/nao pertence a MG/);
  });

  test('a recusa mostra o prefixo esperado', () => {
    const erro = erroDoDestinatario(comEndereco({ uf: 'MG', codigoMunicipio: '3530607' }));
    expect(erro).toMatch(/comeca com 31/);
  });

  test('municipio do estado certo passa', () => {
    expect(erroDoDestinatario(comEndereco({ uf: 'MG', codigoMunicipio: '3136702' }))).toBeUndefined();
  });

  test('os 27 prefixos batem com a UF correspondente', () => {
    // SP e 35 e MG e 31 — os dois digitos NAO seguem a ordem alfabetica, entao
    // errar um so aparece emitindo para aquele estado.
    const prefixos: Record<string, string> = {
      RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
      MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
      MG: '31', ES: '32', RJ: '33', SP: '35',
      PR: '41', SC: '42', RS: '43',
      MS: '50', MT: '51', GO: '52', DF: '53',
    };
    for (const [uf, pref] of Object.entries(prefixos)) {
      expect(erroDoDestinatario(comEndereco({ uf, codigoMunicipio: `${pref}00000` })))
        .toBeUndefined();
      expect(erroDoDestinatario(comEndereco({ uf, codigoMunicipio: '9900000' })))
        .toMatch(new RegExp(`nao pertence a ${uf}`));
    }
  });

  test('exterior nao e conferido contra IBGE', () => {
    // Exportacao usa o codigo 9999999, que nao pertence a UF nenhuma.
    expect(erroDoDestinatario(comEndereco({ uf: 'EX', codigoMunicipio: '9999999' })))
      .toBeUndefined();
  });

  test('sem codigo de municipio nao inventa erro', () => {
    expect(erroDoDestinatario(comEndereco({ codigoMunicipio: '' }))).toBeUndefined();
  });
});

describe('destinatario ausente', () => {
  test('nao quebra e nao acusa nada', () => {
    // NFC-e sai sem destinatario. Uma excecao aqui derrubaria a emissao com
    // erro 500 em vez de deixar a validacao normal seguir.
    expect(erroDoDestinatario(undefined)).toBeUndefined();
    expect(erroDoDestinatario({})).toBeUndefined();
  });

  test('sem bloco de endereco, a UF nao e cobrada', () => {
    // A cobranca de UF vale para quem TEM endereco. Um destinatario so com CPF
    // — o caso do cupom — nao tem endereco e nao deve ser barrado aqui; quem
    // exige o bloco inteiro na NF-e e a rota, antes desta funcao.
    expect(erroDoDestinatario({ cpf: '11144477735' })).toBeUndefined();
  });
});
