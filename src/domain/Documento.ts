/**
 * CPF e CNPJ: normalizacao e digito verificador.
 *
 * A SEFAZ confere o modulo 11 dos dois, e recusa com 207 (CNPJ do destinatario)
 * ou 237 (CPF) — depois de a nota ter sido montada, assinada e transmitida.
 * Em homologacao acontece igual: a razao social e substituida, mas o documento
 * continua sendo conferido.
 *
 * Nao existia calculo de digito em lugar nenhum do projeto: o unico numero
 * conferido era o do emitente, e so o comprimento.
 *
 * Duas coisas diferentes acontecem aqui, e a distincao importa:
 *  - **formatacao** (pontos, barra, hifen) e corrigida em silencio — o operador
 *    cola "33.645.647/0001-20" da tela do cliente e isso sempre foi valido;
 *  - **digito que nao fecha** e RECUSADO, porque adivinhar qual digito o
 *    operador quis digitar mudaria o destinatario da nota.
 */

/** Tira pontuacao de documento. Nao valida nada. */
export function somenteDigitos(valor: string | undefined | null): string {
  return String(valor ?? '').replace(/\D/g, '');
}

/**
 * Modulo 11 com pesos decrescentes, que e o algoritmo dos dois documentos.
 *
 * O CPF conta os pesos de 10 (ou 11) para baixo; o CNPJ cicla de 2 a 9. Por isso
 * o peso entra como funcao, e nao como lista fixa.
 */
function digitoModulo11(base: string, peso: (indice: number, total: number) => number): string {
  let soma = 0;
  for (let i = 0; i < base.length; i++) {
    soma += Number(base[i]) * peso(i, base.length);
  }
  const resto = soma % 11;
  return String(resto < 2 ? 0 : 11 - resto);
}

/**
 * `11111111111` passa no modulo 11 e nao e CPF de ninguem.
 *
 * A SEFAZ recusa esses documentos, e eles aparecem sozinhos: e o que um ERP
 * escreve quando o cadastro do cliente esta vazio.
 */
function todosIguais(digitos: string): boolean {
  return /^(\d)\1+$/.test(digitos);
}

export function cpfValido(valor: string): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 11 || todosIguais(d)) return false;
  const d1 = digitoModulo11(d.slice(0, 9), (i, total) => total + 1 - i);
  const d2 = digitoModulo11(d.slice(0, 10), (i, total) => total + 1 - i);
  return d[9] === d1 && d[10] === d2;
}

export function cnpjValido(valor: string): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 14 || todosIguais(d)) return false;
  // Pesos 2..9 ciclando da direita para a esquerda.
  const peso = (i: number, total: number) => ((total - i - 1) % 8) + 2;
  const d1 = digitoModulo11(d.slice(0, 12), peso);
  const d2 = digitoModulo11(d.slice(0, 13), peso);
  return d[12] === d1 && d[13] === d2;
}

/**
 * Confere o documento e devolve o motivo da recusa, ou `undefined`.
 *
 * A mensagem diz o digito ESPERADO. Sem isso o operador so sabe que errou; com
 * isso ele ve na hora que trocou um numero.
 */
export function erroDeDocumento(
  valor: string | undefined | null,
  tipo: 'cpf' | 'cnpj',
  dono: string,
): string | undefined {
  const bruto = String(valor ?? '').trim();
  if (!bruto) return undefined; // ausencia e outro assunto, com mensagem propria

  const d = somenteDigitos(bruto);
  const tamanho = tipo === 'cpf' ? 11 : 14;
  const rotulo = tipo.toUpperCase();

  if (d.length !== tamanho) {
    return `DOC_INVALIDO: o ${rotulo} do ${dono} ("${bruto}") tem ${d.length} dígito(s) — `
      + `${rotulo} tem ${tamanho}.`;
  }
  if (todosIguais(d)) {
    return `DOC_INVALIDO: o ${rotulo} do ${dono} ("${bruto}") tem todos os dígitos iguais. `
      + 'É o que um cadastro vazio costuma gerar — confira o documento do cliente.';
  }

  const ok = tipo === 'cpf' ? cpfValido(d) : cnpjValido(d);
  if (!ok) {
    const esperado = tipo === 'cpf'
      ? digitoModulo11(d.slice(0, 9), (i, t) => t + 1 - i)
        + digitoModulo11(d.slice(0, 10), (i, t) => t + 1 - i)
      : (() => {
        const peso = (i: number, t: number) => ((t - i - 1) % 8) + 2;
        return digitoModulo11(d.slice(0, 12), peso) + digitoModulo11(d.slice(0, 13), peso);
      })();
    return `DOC_INVALIDO: o ${rotulo} do ${dono} ("${bruto}") não passa no dígito verificador `
      + `— os dois últimos dígitos deveriam ser ${esperado}. Confira o documento do cliente.`;
  }

  return undefined;
}
