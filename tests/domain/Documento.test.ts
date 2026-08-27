import { cpfValido, cnpjValido, erroDeDocumento, somenteDigitos } from '../../src/domain/Documento';

/**
 * Digito verificador de CPF e CNPJ.
 *
 * A SEFAZ confere o modulo 11 dos dois e recusa com 207 (CNPJ do destinatario)
 * ou 237 (CPF) — depois de a nota ter sido montada, assinada e transmitida.
 * Ate agora nao havia calculo de digito em lugar nenhum do projeto: o unico
 * documento conferido era o do emitente, e so o comprimento.
 *
 * Os documentos "validos" abaixo sao CNPJs publicos de empresas reais e CPFs de
 * teste consagrados. Escolhidos de proposito: um algoritmo de DV conferido
 * contra numeros que eu mesmo gerei nao prova nada — provaria so que o gerador e
 * o verificador tem o mesmo defeito.
 */

describe('CNPJ', () => {
  test.each([
    ['50229544000106'],
    ['33645647000120'],
    ['33000167000101'], // Petrobras
    ['60746948000112'], // Bradesco
    ['11222333000181'],
  ])('%s fecha o digito', (cnpj) => {
    expect(cnpjValido(cnpj)).toBe(true);
  });

  test('aceita com pontuacao — colar da tela do cliente sempre funcionou', () => {
    expect(cnpjValido('33.645.647/0001-20')).toBe(true);
  });

  test('um digito trocado nao passa', () => {
    // O erro mais comum de todos, e o que a previa verde escondia.
    expect(cnpjValido('33645647000121')).toBe(false);
  });

  test('todos os digitos iguais nao passam, mesmo fechando o modulo 11', () => {
    // E o que um ERP escreve quando o cadastro do cliente esta vazio.
    expect(cnpjValido('11111111111111')).toBe(false);
  });

  test('tamanho errado nao passa', () => {
    expect(cnpjValido('3364564700012')).toBe(false);
    expect(cnpjValido('336456470001200')).toBe(false);
  });
});

describe('CPF', () => {
  test.each([['11144477735'], ['52998224725'], ['12345678909']])('%s fecha o digito', (cpf) => {
    expect(cpfValido(cpf)).toBe(true);
  });

  test('aceita com pontuacao', () => {
    expect(cpfValido('111.444.777-35')).toBe(true);
  });

  test('um digito trocado nao passa', () => {
    expect(cpfValido('11144477736')).toBe(false);
  });

  test('todos iguais nao passam', () => {
    expect(cpfValido('11111111111')).toBe(false);
    expect(cpfValido('00000000000')).toBe(false);
  });
});

describe('a mensagem de recusa', () => {
  test('diz o digito esperado, nao so que errou', () => {
    // Sem o esperado o operador so sabe que ha um erro; com ele, ve na hora que
    // trocou um numero.
    const erro = erroDeDocumento('33645647000121', 'cnpj', 'destinatário');
    expect(erro).toMatch(/deveriam ser 20/);
  });

  test('mostra o valor como veio, com pontuacao e tudo', () => {
    // Procurar "33645647000121" num cadastro que exibe "33.645.647/0001-21" e
    // trabalho a toa.
    const erro = erroDeDocumento('33.645.647/0001-21', 'cnpj', 'destinatário');
    expect(erro).toMatch(/33\.645\.647\/0001-21/);
  });

  test('diz de quem e o documento', () => {
    expect(erroDeDocumento('33645647000121', 'cnpj', 'destinatário')).toMatch(/destinatário/);
    expect(erroDeDocumento('33645647000121', 'cnpj', 'emitente')).toMatch(/emitente/);
  });

  test('tamanho errado tem mensagem propria, nao a de digito', () => {
    const erro = erroDeDocumento('336456470001', 'cnpj', 'destinatário');
    expect(erro).toMatch(/12 dígito\(s\)/);
    expect(erro).not.toMatch(/dígito verificador/);
  });

  test('cadastro vazio e nomeado como tal', () => {
    expect(erroDeDocumento('11111111111111', 'cnpj', 'destinatário'))
      .toMatch(/todos os dígitos iguais/);
  });

  test('documento valido nao gera erro', () => {
    expect(erroDeDocumento('33645647000120', 'cnpj', 'destinatário')).toBeUndefined();
    expect(erroDeDocumento('11144477735', 'cpf', 'destinatário')).toBeUndefined();
  });

  test('ausente nao e erro AQUI — quem cobra presenca e outra regra', () => {
    // NF-e leva CNPJ OU CPF, nunca os dois. Se esta funcao cobrasse presenca,
    // toda nota para pessoa fisica seria recusada pelo CNPJ que falta.
    expect(erroDeDocumento(undefined, 'cnpj', 'destinatário')).toBeUndefined();
    expect(erroDeDocumento('', 'cpf', 'destinatário')).toBeUndefined();
  });
});

describe('somenteDigitos', () => {
  test('tira pontuacao e nao valida nada', () => {
    expect(somenteDigitos('33.645.647/0001-20')).toBe('33645647000120');
    expect(somenteDigitos('111.444.777-35')).toBe('11144477735');
    expect(somenteDigitos(undefined)).toBe('');
  });
});
