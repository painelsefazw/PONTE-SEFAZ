/**
 * Consulta de municipio pelo codigo do IBGE.
 *
 * A tabela vive como texto em `municipios.ts` e vira mapa na primeira consulta.
 * Ler 5.571 linhas custa poucos milissegundos e acontece uma vez por instancia
 * — montar o mapa no carregamento do modulo faria toda requisicao pagar por
 * isso, inclusive as que nunca imprimem DANFSe.
 */

import { TABELA_MUNICIPIOS, UF_POR_CODIGO } from './municipios';

export interface Municipio {
  /** Codigo do IBGE, 7 digitos. */
  codigo: string;
  nome: string;
  uf: string;
}

let indice: Map<string, string> | undefined;

function carregar(): Map<string, string> {
  if (indice) return indice;
  indice = new Map();
  for (const linha of TABELA_MUNICIPIOS.split('\n')) {
    // "3530607 Mogi das Cruzes" — o nome pode ter espacos, o codigo nunca.
    const sep = linha.indexOf(' ');
    if (sep > 0) indice.set(linha.slice(0, sep), linha.slice(sep + 1));
  }
  return indice;
}

/** UF a partir do codigo do municipio: os dois primeiros digitos sao a UF. */
export function ufDoCodigo(codigo?: string): string | undefined {
  const c = (codigo ?? '').replace(/\D/g, '');
  return c.length === 7 ? UF_POR_CODIGO[c.slice(0, 2)] : undefined;
}

/**
 * Municipio pelo codigo, ou `undefined` se o codigo nao existir na tabela.
 *
 * Devolver `undefined` em vez de inventar e proposital: um codigo desconhecido
 * costuma ser dado errado na origem, e o DANFSe tem que mostrar isso — a NT
 * proibe imprimir informacao que nao conste do arquivo.
 */
export function municipioPorCodigo(codigo?: string): Municipio | undefined {
  const c = (codigo ?? '').replace(/\D/g, '');
  if (c.length !== 7) return undefined;
  const nome = carregar().get(c);
  const uf = ufDoCodigo(c);
  return nome && uf ? { codigo: c, nome, uf } : undefined;
}

/**
 * "Mogi das Cruzes / SP" — o formato que a NT pede em "Municipio / Sigla UF".
 *
 * Sem o codigo na tabela, devolve o que der: a UF informada no XML, ou o
 * proprio codigo. Melhor um dado incompleto e verdadeiro do que nenhum.
 */
export function municipioUf(codigo?: string, ufInformada?: string): string | undefined {
  const m = municipioPorCodigo(codigo);
  if (m) return `${m.nome} / ${m.uf}`;
  const partes = [codigo, ufInformada].map(p => (p ?? '').trim()).filter(Boolean);
  return partes.length ? partes.join(' / ') : undefined;
}

/** Quantos municipios a tabela conhece — usado nos testes e no diagnostico. */
export function totalMunicipios(): number {
  return carregar().size;
}
