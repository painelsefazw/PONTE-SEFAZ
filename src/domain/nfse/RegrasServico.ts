/**
 * Regras do código de tributação nacional do ISSQN (cTribNac).
 *
 * Tudo aqui foi levantado contra a produção restrita da SEFIN, não de
 * documentação: a lista oficial de códigos não é publicada em formato
 * consultável, e o endpoint de alíquotas do ADN responde a mesma mensagem de
 * "nove dígitos" para qualquer entrada, então não serve de fonte.
 *
 * O método foi usar as próprias rejeições como oráculo. A SEFIN valida nesta
 * ordem, e cada erro revela uma coisa diferente sobre o código:
 *
 *   E0310  o código não existe na lista nacional
 *   E0370  o grupo de obra é obrigatório e não veio
 *   E0372  o grupo de obra veio e não é permitido
 *   E0312  o código existe, mas o município não o administra
 *
 * Como E0370/E0372 são avaliados antes de E0312, dá para separar "é serviço de
 * obra" de "o município administra" sem depender de nenhuma tabela.
 */

/**
 * Desdobro nacional — os dois últimos dígitos do cTribNac.
 *
 * Começa em 01. O desdobro `00` não existe para nenhum item/subitem: é o erro
 * natural de quem lê "2 dígitos de desdobro" e assume que o valor neutro é
 * zero, e custa um E0310 que não diz qual das três partes está errada.
 */
export const DESDOBRO_MINIMO = '01';

/**
 * Subitens da LC 116/2003 que exigem a identificação da obra.
 *
 * Levantado varrendo o item 07 inteiro contra a SEFIN. São os subitens de
 * execução — não os de projeto ou consultoria, que ficam de fora:
 *
 *   07.02  execução de obras de construção civil
 *   07.04  demolição
 *   07.05  reparação, conservação e reforma de edifícios
 *   07.06  colocação e instalação de revestimentos, com material
 *   07.07  recuperação, raspagem e polimento de pisos
 *   07.08  calafetação
 *   07.17  escoramento, contenção de encostas
 *   07.19  acompanhamento e fiscalização de obra
 */
export const SUBITENS_COM_OBRA = ['0702', '0704', '0705', '0706', '0707', '0708', '0717', '0719'];

/** Diz se o código exige o grupo `obra` na DPS. */
export function exigeObra(codigoTributacaoNacional: string): boolean {
  return SUBITENS_COM_OBRA.includes(String(codigoTributacaoNacional ?? '').replace(/\D/g, '').slice(0, 4));
}

/**
 * Recusa localmente o que a SEFIN recusaria — mas dizendo qual é o problema.
 *
 * Vale a ida ao servidor só quando a nota tem chance de passar: as rejeições
 * daqui chegam com o campo e o motivo, enquanto o E0310 chega com "o código não
 * existe" e deixa o operador adivinhando entre item, subitem e desdobro.
 */
export function validarServico(
  codigoTributacaoNacional: string,
  temGrupoObra: boolean,
): void {
  const cod = String(codigoTributacaoNacional ?? '').replace(/\D/g, '');

  if (cod.length !== 6) {
    throw new Error(
      `NFSE_CTRIBNAC_INVALIDO: "${codigoTributacaoNacional}" — o código de tributação `
      + 'nacional tem 6 dígitos: 2 do item da LC 116, 2 do subitem e 2 do desdobro.',
    );
  }

  if (cod.slice(4) === '00') {
    throw new Error(
      `NFSE_DESDOBRO_INVALIDO: "${cod}" — o desdobro nacional começa em ${DESDOBRO_MINIMO}. `
      + `Para o subitem ${cod.slice(0, 2)}.${cod.slice(2, 4)} o código provável é ${cod.slice(0, 4)}${DESDOBRO_MINIMO}.`,
    );
  }

  const precisa = exigeObra(cod);
  if (precisa && !temGrupoObra) {
    throw new Error(
      `NFSE_OBRA_OBRIGATORIA: o subitem ${cod.slice(0, 2)}.${cod.slice(2, 4)} é serviço de obra. `
      + 'Informe o CNO/CEI, o CIB ou o endereço da obra (a SEFIN recusa com E0370).',
    );
  }
  if (!precisa && temGrupoObra) {
    throw new Error(
      `NFSE_OBRA_NAO_PERMITIDA: o subitem ${cod.slice(0, 2)}.${cod.slice(2, 4)} não é serviço de obra, `
      + 'então o grupo de obra não pode ser enviado (a SEFIN recusa com E0372).',
    );
  }
}
