/**
 * Duplicacao de nota: reconstroi os dados de emissao a partir de uma NF-e ja
 * autorizada.
 *
 * O historico guarda a NF-e montada (`nfe_json`), e nao o formulario que a
 * originou. Reverter a partir dela — em vez de passar a salvar o formulario —
 * faz a duplicacao valer para as notas que ja existem, que sao justamente as
 * que o usuario quer repetir.
 *
 * O que NAO volta, de proposito:
 *
 *   numero, chave, data, protocolo  — sao da nota original; a copia e uma nota
 *                                     nova e recebe os seus.
 *   demonstrativo IBS/CBS           — o motor reanexa na emissao; manter aqui
 *                                     duplicaria o texto a cada copia.
 *   emitente                        — vem da empresa selecionada, nao da nota.
 */

import type {
  NFe, DetalheItem, TipoICMS, TipoIPI, TipoPIS, TipoCOFINS, Endereco,
} from './models';
import type {
  FiscalContextItem, FiscalContextICMS, FiscalContextIPI, FiscalContextEndereco,
} from './FiscalContext';

/**
 * Trecho gerado por `buildNFe` nas informacoes complementares. Reconhecido aqui
 * para ser removido na copia — ver `limparDemonstrativo`.
 */
export const PREFIXO_DEMONSTRATIVO_IBSCBS = 'Reforma Tributaria (LC 214/2025)';

/** Dados de emissao prontos para preencher o formulario. */
export interface NotaDuplicada {
  destinatario: {
    cnpj?: string;
    cpf?: string;
    razaoSocial: string;
    indIEDest: string;
    ie?: string;
    email?: string;
    endereco: FiscalContextEndereco;
  };
  itens: FiscalContextItem[];
  pagamento: { formas: Array<{ tipo: string; valor: string }>; troco?: string };
  naturezaOperacao: string;
  tipoOperacao: string;
  indFinal?: string;
  presenca: string;
  modFrete?: string;
  serie: string;
  informacoesAdicionais?: { fisco?: string; complementar?: string };
  pICMSUFDest?: string;
  mod?: '55' | '65';
  /** Origem da copia, so para a tela avisar o usuario. */
  origem: { chaveAcesso?: string; numero: string; serie: string };
}

/**
 * Remove o demonstrativo que `buildNFe` anexa, devolvendo so o texto do usuario.
 *
 * O separador ' | ' tambem e usado dentro do proprio demonstrativo, entao o
 * corte e feito no inicio do prefixo e nao por split.
 */
export function limparDemonstrativo(infCpl?: string): string | undefined {
  if (!infCpl) return undefined;
  const i = infCpl.indexOf(PREFIXO_DEMONSTRATIVO_IBSCBS);
  const texto = (i === -1 ? infCpl : infCpl.slice(0, i)).replace(/\s*\|\s*$/, '').trim();
  return texto || undefined;
}

function toEnderecoForm(e: Endereco): FiscalContextEndereco {
  return {
    logradouro: e.xLgr,
    numero: e.nro,
    complemento: e.xCpl,
    bairro: e.xBairro,
    codigoMunicipio: e.cMun,
    nomeMunicipio: e.xMun,
    uf: e.UF,
    cep: e.CEP,
    fone: e.fone,
  };
}

/** Extrai o unico membro de uma uniao discriminada ({ ICMS00: {...} } → {...}). */
function conteudoDoGrupo<T>(grupo: T | undefined): any | undefined {
  if (!grupo) return undefined;
  const chaves = Object.keys(grupo as object);
  return chaves.length ? (grupo as any)[chaves[0]] : undefined;
}

function toIcmsForm(icms: TipoICMS | undefined): FiscalContextICMS {
  const g = conteudoDoGrupo(icms);
  if (!g) return { origem: '0', csosn: '102' };

  const base: FiscalContextICMS = { origem: g.orig ?? '0' };
  // CSOSN e CST ocupam o mesmo campo na tela; o Simples usa codigo de 3 digitos.
  if (g.CSOSN) base.csosn = g.CSOSN;
  else if (g.CST) base.cst = g.CST;

  const copiar = [
    'modBC', 'vBC', 'pICMS', 'vICMS', 'pRedBC', 'vICMSDeson', 'motDesICMS',
    'modBCST', 'pMVAST', 'pRedBCST', 'vBCST', 'pICMSST', 'vICMSST',
    'vBCSTRet', 'vICMSSTRet', 'pCredSN', 'vCredICMSSN',
  ] as const;
  for (const campo of copiar) {
    if (g[campo] !== undefined) (base as any)[campo] = g[campo];
  }
  return base;
}

function toIpiForm(ipi: TipoIPI | undefined): FiscalContextIPI | undefined {
  const g = conteudoDoGrupo(ipi);
  if (!g) return undefined;
  return {
    cst: g.CST,
    cEnq: g.cEnq,
    vBC: g.vBC,
    pIPI: g.pIPI,
    vIPI: g.vIPI,
  };
}

function toPisForm(pis: TipoPIS | undefined): { cst: string; aliquota?: string } {
  const g = conteudoDoGrupo(pis);
  if (!g) return { cst: '99' };
  return { cst: g.CST, aliquota: g.pPIS };
}

function toCofinsForm(cofins: TipoCOFINS | undefined): { cst: string; aliquota?: string } {
  const g = conteudoDoGrupo(cofins);
  if (!g) return { cst: '99' };
  return { cst: g.CST, aliquota: g.pCOFINS };
}

function toItemForm(det: DetalheItem): FiscalContextItem {
  const p = det.prod;
  const item: FiscalContextItem = {
    codigo: p.cProd,
    descricao: p.xProd,
    ncm: p.NCM,
    cfop: p.CFOP,
    unidade: p.uCom,
    quantidade: p.qCom,
    // vUnCom sai do XML com 10 casas ("1234.5600000000"). A tela trabalha com
    // 2; as casas extras existem para o rateio e nao para digitacao.
    valorUnitario: normalizarValorUnitario(p.vUnCom),
    icms: toIcmsForm(det.imposto.ICMS),
    pis: toPisForm(det.imposto.PIS),
    cofins: toCofinsForm(det.imposto.COFINS),
  };
  if (p.cEAN && p.cEAN !== 'SEM GTIN') item.ean = p.cEAN;
  if (p.CEST) item.cest = p.CEST;

  const ipi = toIpiForm(det.imposto.IPI);
  if (ipi) item.ipi = ipi;

  // So volta quando o produto tem tratamento proprio. No caso integral
  // (000/000001) o motor aplica o padrao sozinho.
  const ibs = det.imposto.IBSCBS;
  if (ibs && !(ibs.CST === '000' && ibs.cClassTrib === '000001')) {
    item.ibscbs = { cst: ibs.CST, cClassTrib: ibs.cClassTrib };
    // A reducao precisa voltar junto: sem ela a copia de um item com CST 200
    // nao consegue ser remontada, porque so o cClassTrib nao diz quanto reduz.
    const pRed = ibs.gIBSCBS.gCBS.gRed?.pRedAliq ?? ibs.gIBSCBS.gIBSUF.gRed?.pRedAliq;
    if (pRed) item.ibscbs.pRedAliq = pRed;
  }
  return item;
}

/**
 * Corta as casas decimais de rateio do valor unitario, preservando o valor.
 *
 * "1234.5600000000" vira "1234.56", mas "0.0001" continua inteiro: arredondar
 * para 2 casas zeraria o preco de item vendido em fracao.
 */
function normalizarValorUnitario(v: string): string {
  if (!v.includes('.')) return v;
  const semZeros = v.replace(/0+$/, '').replace(/\.$/, '');
  const casas = semZeros.split('.')[1]?.length ?? 0;
  return casas <= 2 ? Number(semZeros).toFixed(2) : semZeros;
}

export function duplicarNota(nfe: NFe): NotaDuplicada {
  const dest = nfe.dest;
  const dup: NotaDuplicada = {
    destinatario: {
      cnpj: dest?.CNPJ,
      cpf: dest?.CPF,
      razaoSocial: dest?.xNome ?? '',
      indIEDest: dest?.indIEDest ?? '9',
      ie: dest?.IE,
      email: dest?.email,
      endereco: dest?.enderDest
        ? toEnderecoForm(dest.enderDest)
        : {
          logradouro: '', numero: '', bairro: '',
          codigoMunicipio: '', nomeMunicipio: '', uf: '', cep: '',
        },
    },
    itens: nfe.det.map(toItemForm),
    pagamento: {
      formas: (nfe.pag?.detPag ?? []).map(d => ({ tipo: d.tPag, valor: d.vPag })),
      troco: nfe.pag?.vTroco,
    },
    naturezaOperacao: nfe.ide.natOp,
    tipoOperacao: nfe.ide.tpNF,
    indFinal: nfe.ide.indFinal,
    presenca: nfe.ide.indPres,
    modFrete: nfe.transp?.modFrete,
    serie: nfe.ide.serie,
    mod: nfe.ide.mod as '55' | '65',
    origem: { numero: nfe.ide.nNF, serie: nfe.ide.serie },
  };

  const complementar = limparDemonstrativo(nfe.infAdic?.infCpl);
  const fisco = nfe.infAdic?.infAdFisco;
  if (complementar || fisco) {
    dup.informacoesAdicionais = { fisco, complementar };
  }

  // A aliquota interna do destino nao volta no XML pronta para reuso: o que
  // existe e o vICMSUFDest ja calculado. Recupera a aliquota do primeiro item
  // que tenha DIFAL para a tela nao perder o valor digitado.
  const difal = nfe.det.find(d => d.imposto.ICMSUFDest)?.imposto.ICMSUFDest;
  if (difal?.pICMSUFDest) dup.pICMSUFDest = difal.pICMSUFDest;

  return dup;
}
