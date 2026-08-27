import { erroDeCep } from '../../src/domain/FiscalContext';

/**
 * CEP: formatacao e corrigida, incoerencia e recusada.
 *
 * O navegador sempre fez `replace(/\D/g,'')` no CEP e no telefone — quem entrava
 * pela API e que nao tinha essa rede, e "08710-100" ia com hifen para um campo
 * cujo leiaute exige `[0-9]{8}`. Rejeicao de schema, sem dizer o campo.
 *
 * A faixa por UF pega o que nenhuma conferencia de formato pega: CEP copiado do
 * cadastro de outro cliente. "01310-100" (Sao Paulo) num endereco de MG tem oito
 * digitos, passa em tudo, e a SEFAZ recusa.
 */

describe('formato', () => {
  test('pontuacao nao e erro — some antes de conferir', () => {
    expect(erroDeCep('08810-240', 'SP')).toBeUndefined();
    expect(erroDeCep('08810 240', 'SP')).toBeUndefined();
  });

  test('digito a menos e recusado dizendo quantos vieram', () => {
    expect(erroDeCep('881024', 'SP')).toMatch(/tem 6 dígito\(s\)/);
  });

  test('digito a mais tambem', () => {
    expect(erroDeCep('088102400', 'SP')).toMatch(/tem 9 dígito\(s\)/);
  });

  test('ausente nao e erro AQUI — quem cobra presenca e outra regra', () => {
    expect(erroDeCep(undefined, 'SP')).toBeUndefined();
    expect(erroDeCep('', 'SP')).toBeUndefined();
  });
});

describe('faixa por UF', () => {
  test('CEP de Sao Paulo em endereco de Minas e recusado', () => {
    expect(erroDeCep('01310100', 'MG')).toMatch(/não pertence a MG/);
  });

  test('a recusa mostra a faixa esperada', () => {
    expect(erroDeCep('01310100', 'MG')).toMatch(/30000000-39999999/);
  });

  test('a recusa nomeia a causa provavel', () => {
    expect(erroDeCep('01310100', 'MG')).toMatch(/copiado de outro cliente/);
  });

  test.each([
    ['SP', '01310100'], ['MG', '30140071'], ['RJ', '20040020'],
    ['BA', '40020000'], ['RS', '90010150'], ['PR', '80010000'],
    ['DF', '70040010'], ['CE', '60160230'], ['PE', '50030230'],
    ['SC', '88010001'], ['GO', '74003010'], ['MT', '78005000'],
  ])('%s aceita um CEP real do estado', (uf, cep) => {
    expect(erroDeCep(cep, uf)).toBeUndefined();
  });

  test('as duas faixas do Amazonas valem', () => {
    // O AM tem faixa partida (69000-69299 e 69400-69899). Uma tabela com uma
    // entrada por UF recusaria metade do estado.
    expect(erroDeCep('69005000', 'AM')).toBeUndefined();
    expect(erroDeCep('69460000', 'AM')).toBeUndefined();
  });

  test('exterior nao e conferido', () => {
    expect(erroDeCep('99999999', 'EX')).toBeUndefined();
  });

  test('sem UF nao inventa erro', () => {
    expect(erroDeCep('01310100', undefined)).toBeUndefined();
  });

  test('UF minuscula e tratada igual', () => {
    // A normalizacao acontece na rota, mas esta funcao tambem e chamada do
    // dominio, onde a UF pode chegar como veio.
    expect(erroDeCep('01310100', 'mg')).toMatch(/não pertence a MG/);
  });
});
