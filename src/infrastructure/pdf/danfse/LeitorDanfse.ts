/**
 * Leitura da NFS-e para o DANFSe v2.0.
 *
 * O `NfseParser` existente expõe o que o resto do sistema precisa (número,
 * valores, status). A NT 008/2026 pede bem mais: endereços completos, contatos,
 * regime tributário, NBS e os quatorze campos do bloco IBS/CBS. Em vez de
 * inchar aquele tipo — que muita coisa consome — a leitura do documento
 * impresso mora aqui.
 *
 * Segue a mesma escolha do parser original: expressão regular sobre o XML
 * assinado, sem re-serializar nada.
 *
 * Regra que atravessa o arquivo inteiro: **não calcular**. A NT diz, no item
 * 2.1, que os campos "deverão representar o conteúdo das respectivas TAG XML" e
 * que "não poderão ser impressas informações que não constem do arquivo". Onde
 * falta dado, imprime-se traço — não um valor deduzido.
 */

export interface Parte {
  documento?: string;      // CNPJ, CPF ou NIF, o que houver
  im?: string;
  fone?: string;
  nome?: string;
  municipio?: string;      // código IBGE; o nome sai da tabela do município
  municipioNome?: string;
  uf?: string;
  cep?: string;
  endereco?: string;       // xLgr, nro, xCpl, xBairro concatenados
  email?: string;
}

export interface DanfseDados {
  chaveAcesso?: string;
  numero?: string;
  competencia?: string;
  dataProcessamento?: string;
  numeroDps?: string;
  serieDps?: string;
  dataEmissaoDps?: string;
  tipoEmitente?: string;
  situacao?: string;
  finalidade?: string;
  municipioEmissor?: string;
  ambienteGerador?: string;
  tipoAmbiente?: string;
  cancelada: boolean;
  substituida: boolean;

  prestador: Parte & { optanteSimples?: string; regimeApuracaoSN?: string };
  tomador: Parte;
  destinatario?: Parte;
  intermediario?: Parte;

  servico: {
    codigoTributacaoNacional?: string;
    codigoNbs?: string;
    localPrestacao?: string;
    descricaoTributacao?: string;
    descricao?: string;
  };

  issqn: {
    tipoTributacao?: string;
    municipioIncidencia?: string;
    regimeEspecial?: string;
    imunidade?: string;
    suspensao?: string;
    processoSuspensao?: string;
    beneficioMunicipal?: string;
    totalDeducoes?: string;
    descontoIncondicionado?: string;
    baseCalculo?: string;
    aliquota?: string;
    retencao?: string;
    apurado?: string;
  };

  /** Bloco impresso só para competências até o fim de 2026 (nota 6). */
  federal: {
    irrf?: string;
    previdenciaria?: string;
    sociaisRetidas?: string;
    pis?: string;
    cofins?: string;
  };

  /** Os quatorze campos do item 2.1.10. */
  ibscbs: {
    cst?: string;
    cClassTrib?: string;
    indicadorOperacao?: string;
    codigoIncidencia?: string;
    municipioIncidencia?: string;
    exclusoesReducoes?: string;
    baseCalculo?: string;
    redAliqIBSUF?: string;
    redAliqIBSMun?: string;
    redAliqCBS?: string;
    aliqIBSUF?: string;
    aliqIBSMun?: string;
    aliqEfetivaMun?: string;
    valorIBSMun?: string;
    aliqEfetivaUF?: string;
    valorIBSUF?: string;
    valorIBSTotal?: string;
    aliqCBS?: string;
    aliqEfetivaCBS?: string;
    valorCBS?: string;
  };

  totais: {
    valorServico?: string;
    descontoIncondicionado?: string;
    descontoCondicionado?: string;
    totalRetencoes?: string;
    liquido?: string;
    totalIbsCbs?: string;
    liquidoMaisIbsCbs?: string;
    tribFederais?: string;
    tribEstaduais?: string;
    tribMunicipais?: string;
    percentualTributos?: boolean;
  };

  informacoesComplementares: string[];
}

function tag(xml: string, nome: string): string | undefined {
  const m = xml.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([^<]*)</${nome}>`));
  const v = m ? m[1].trim() : '';
  return v || undefined;
}

function grupo(xml: string, nome: string): string {
  const m = xml.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`));
  return m ? m[1] : '';
}

/** Junta partes não vazias com separador — o padrão de concatenação da NT. */
function juntar(sep: string, ...partes: (string | undefined)[]): string | undefined {
  const v = partes.map(p => (p ?? '').trim()).filter(Boolean);
  return v.length ? v.join(sep) : undefined;
}

/** Documento da parte, na ordem em que a NT lista: CNPJ, CPF ou NIF. */
function documentoDe(escopo: string): string | undefined {
  return tag(escopo, 'CNPJ') ?? tag(escopo, 'CPF') ?? tag(escopo, 'NIF');
}

function lerParte(escopo: string): Parte {
  if (!escopo) return {};
  const end = grupo(escopo, 'end') || escopo;
  const nac = grupo(end, 'endNac');
  const ext = grupo(end, 'endExt');

  return {
    documento: documentoDe(escopo),
    im: tag(escopo, 'IM'),
    fone: tag(escopo, 'fone'),
    nome: tag(escopo, 'xNome'),
    // O leiaute traz o código IBGE; o nome do município vem da tabela, exceto
    // no endereço externo, que já traz a cidade por extenso.
    municipio: tag(nac, 'cMun') ?? tag(grupo(escopo, 'enderNac'), 'cMun'),
    municipioNome: tag(ext, 'xCidade'),
    uf: tag(escopo, 'UF'),
    cep: tag(nac, 'CEP') ?? tag(grupo(escopo, 'enderNac'), 'CEP') ?? tag(ext, 'cEndPost'),
    endereco: juntar(', ', tag(end, 'xLgr'), tag(end, 'nro'), tag(end, 'xCpl'), tag(end, 'xBairro'))
      ?? juntar(', ', tag(escopo, 'xLgr'), tag(escopo, 'nro'), tag(escopo, 'xCpl'), tag(escopo, 'xBairro')),
    email: tag(escopo, 'email'),
  };
}

export function lerDanfse(xml: string): DanfseDados {
  const inf = grupo(xml, 'infNFSe') || xml;
  const dps = grupo(inf, 'infDPS');

  const idAttr = xml.match(/<infNFSe[^>]*\bId="([^"]+)"/);
  const chaveAcesso = idAttr ? idAttr[1].replace(/\D/g, '') : undefined;

  const emit = grupo(inf, 'emit');
  const valoresNota = grupo(inf, 'valores');
  const prest = grupo(dps, 'prest');
  const serv = grupo(dps, 'serv');
  const valoresDps = grupo(dps, 'valores');

  // Dois grupos <IBSCBS>: o do infNFSe traz os valores apurados, o do infDPS
  // traz CST, classificação e indicador de operação.
  const ibsNota = grupo(inf, 'IBSCBS');
  const ibsDps = grupo(dps, 'IBSCBS');
  const ibsValores = grupo(ibsNota, 'valores');
  const totCIBS = grupo(ibsNota, 'totCIBS');

  const status = tag(inf, 'cStat');
  const totTrib = grupo(grupo(valoresDps, 'totTrib'), 'vTotTrib');
  const pTotTrib = grupo(grupo(valoresDps, 'totTrib'), 'pTotTrib');
  const usaPercentual = !!pTotTrib && !totTrib;

  return {
    chaveAcesso,
    numero: tag(inf, 'nNFSe'),
    competencia: tag(dps, 'dCompet'),
    dataProcessamento: tag(inf, 'dhProc'),
    numeroDps: tag(dps, 'nDPS'),
    serieDps: tag(dps, 'serie'),
    dataEmissaoDps: tag(dps, 'dhEmi'),
    tipoEmitente: tag(dps, 'tpEmit'),
    situacao: status,
    finalidade: tag(ibsDps, 'finNFSe'),
    municipioEmissor: tag(inf, 'xLocEmi'),
    ambienteGerador: tag(inf, 'ambGer'),
    tipoAmbiente: tag(dps, 'tpAmb'),
    // 101 é o status de nota cancelada no Sistema Nacional.
    cancelada: status === '101',
    substituida: !!tag(dps, 'chSubstda'),

    prestador: {
      ...lerParte(prest),
      // O endereço do prestador está no <emit> da nota, não no DPS.
      ...(() => {
        const e = lerParte(emit);
        return { municipio: e.municipio, uf: e.uf, cep: e.cep, endereco: e.endereco, nome: e.nome };
      })(),
      documento: documentoDe(emit) ?? documentoDe(prest),
      im: tag(emit, 'IM') ?? tag(prest, 'IM'),
      fone: tag(emit, 'fone') ?? tag(prest, 'fone'),
      email: tag(emit, 'email') ?? tag(prest, 'email'),
      optanteSimples: tag(grupo(prest, 'regTrib'), 'opSimpNac'),
      regimeApuracaoSN: tag(grupo(prest, 'regTrib'), 'regApTribSN'),
    },
    tomador: lerParte(grupo(dps, 'toma')),
    destinatario: lerParte(grupo(dps, 'dest')),
    intermediario: lerParte(grupo(dps, 'interm')),

    servico: {
      codigoTributacaoNacional: tag(grupo(serv, 'cServ'), 'cTribNac'),
      codigoNbs: tag(grupo(serv, 'cServ'), 'cNBS'),
      localPrestacao: tag(inf, 'xLocPrestacao'),
      descricaoTributacao: tag(inf, 'xTribNac'),
      descricao: tag(grupo(serv, 'cServ'), 'xDescServ'),
    },

    issqn: {
      tipoTributacao: tag(grupo(valoresDps, 'tribMun'), 'tribISSQN'),
      municipioIncidencia: juntar(' / ', tag(inf, 'cLocIncid'), tag(inf, 'xLocIncid')),
      regimeEspecial: tag(grupo(prest, 'regTrib'), 'regEspTrib'),
      imunidade: tag(grupo(valoresDps, 'tribMun'), 'tpImunidade'),
      suspensao: tag(grupo(valoresDps, 'tribMun'), 'tpSusp'),
      processoSuspensao: tag(grupo(valoresDps, 'tribMun'), 'nProcesso'),
      beneficioMunicipal: tag(grupo(valoresDps, 'tribMun'), 'nBM'),
      totalDeducoes: tag(valoresDps, 'vTotDedRed'),
      descontoIncondicionado: tag(grupo(valoresDps, 'vDescCondIncond'), 'vDescIncond'),
      baseCalculo: tag(valoresNota, 'vBC'),
      aliquota: tag(valoresNota, 'pAliqAplic'),
      retencao: tag(grupo(valoresDps, 'tribMun'), 'tpRetISSQN'),
      apurado: tag(valoresNota, 'vISSQN'),
    },

    federal: {
      irrf: tag(grupo(valoresDps, 'tribFed'), 'vRetIRRF'),
      previdenciaria: tag(grupo(valoresDps, 'tribFed'), 'vRetCP'),
      sociaisRetidas: tag(grupo(valoresDps, 'tribFed'), 'vRetCSLL'),
      pis: tag(grupo(valoresDps, 'piscofins'), 'vPis'),
      cofins: tag(grupo(valoresDps, 'piscofins'), 'vCofins'),
    },

    ibscbs: {
      cst: tag(grupo(ibsDps, 'gIBSCBS'), 'CST'),
      cClassTrib: tag(grupo(ibsDps, 'gIBSCBS'), 'cClassTrib'),
      indicadorOperacao: tag(ibsDps, 'cIndOp'),
      codigoIncidencia: tag(ibsNota, 'cLocalidadeIncid'),
      municipioIncidencia: tag(ibsNota, 'xLocalidadeIncid'),
      // A NT manda somar desconto incondicionado, reembolso, ISSQN, PIS e
      // COFINS. É soma de campos do XML, não apuração nova.
      exclusoesReducoes: somarExclusoes(valoresDps, valoresNota, ibsValores),
      baseCalculo: tag(ibsValores, 'vBC'),
      redAliqIBSUF: tag(grupo(ibsValores, 'uf'), 'pRedAliqUF'),
      redAliqIBSMun: tag(grupo(ibsValores, 'mun'), 'pRedAliqMun'),
      redAliqCBS: tag(grupo(ibsValores, 'fed'), 'pRedAliqCBS'),
      aliqIBSUF: tag(grupo(ibsValores, 'uf'), 'pIBSUF'),
      aliqIBSMun: tag(grupo(ibsValores, 'mun'), 'pIBSMun'),
      aliqEfetivaMun: tag(grupo(ibsValores, 'mun'), 'pAliqEfetMun'),
      valorIBSMun: tag(grupo(grupo(totCIBS, 'gIBS'), 'gIBSMunTot'), 'vIBSMun'),
      aliqEfetivaUF: tag(grupo(ibsValores, 'uf'), 'pAliqEfetUF'),
      valorIBSUF: tag(grupo(grupo(totCIBS, 'gIBS'), 'gIBSUFTot'), 'vIBSUF'),
      valorIBSTotal: tag(grupo(totCIBS, 'gIBS'), 'vIBSTot'),
      aliqCBS: tag(grupo(ibsValores, 'fed'), 'pCBS'),
      aliqEfetivaCBS: tag(grupo(ibsValores, 'fed'), 'pAliqEfetCBS'),
      valorCBS: tag(grupo(totCIBS, 'gCBS'), 'vCBS'),
    },

    totais: {
      valorServico: tag(grupo(valoresDps, 'vServPrest'), 'vServ'),
      descontoIncondicionado: tag(grupo(valoresDps, 'vDescCondIncond'), 'vDescIncond'),
      descontoCondicionado: tag(grupo(valoresDps, 'vDescCondIncond'), 'vDescCond'),
      totalRetencoes: tag(valoresNota, 'vTotalRet'),
      liquido: tag(valoresNota, 'vLiq'),
      totalIbsCbs: somar(tag(grupo(totCIBS, 'gIBS'), 'vIBSTot'), tag(grupo(totCIBS, 'gCBS'), 'vCBS')),
      // vTotNF sai do XML como está. A NT proíbe imprimir o que não consta do
      // arquivo, então nada de recalcular líquido + IBS/CBS aqui.
      liquidoMaisIbsCbs: tag(totCIBS, 'vTotNF'),
      tribFederais: tag(totTrib, 'vTotTribFed') ?? tag(pTotTrib, 'pTotTribFed'),
      tribEstaduais: tag(totTrib, 'vTotTribEst') ?? tag(pTotTrib, 'pTotTribEst'),
      tribMunicipais: tag(totTrib, 'vTotTribMun') ?? tag(pTotTrib, 'pTotTribMun'),
      percentualTributos: usaPercentual,
    },

    informacoesComplementares: montarInfoComplementares(dps),
  };
}

function somar(...valores: (string | undefined)[]): string | undefined {
  const nums = valores.filter(Boolean).map(Number).filter(n => !Number.isNaN(n));
  return nums.length ? nums.reduce((a, b) => a + b, 0).toFixed(2) : undefined;
}

/** Somatório que a NT define para "Exclusões e Reduções da Base de Cálculo". */
function somarExclusoes(valoresDps: string, valoresNota: string, ibsValores: string): string | undefined {
  const piscofins = grupo(valoresDps, 'piscofins');
  return somar(
    tag(grupo(valoresDps, 'vDescCondIncond'), 'vDescIncond'),
    tag(ibsValores, 'vCalcReeRepRes'),
    tag(valoresNota, 'vISSQN'),
    tag(piscofins, 'vPis'),
    tag(piscofins, 'vCofins'),
  );
}

/**
 * Informações complementares, na ordem e com os rótulos que a NT fixa
 * (item 2.4.5, campo INFORMAÇÕES COMPLEMENTARES e notas 7 a 9).
 *
 * A linha de Totais Aproximados dos Tributos não entra aqui: a NT a trata como
 * fixa, e ela é montada no renderizador para nunca ser cortada pelo limite.
 */
function montarInfoComplementares(dps: string): string[] {
  const serv = grupo(dps, 'serv');
  const info = grupo(serv, 'infoCompl');
  const obra = grupo(serv, 'obra');
  const partes: Array<[string, string | undefined]> = [
    ['Inf. Cont.:', tag(info, 'xInfComp')],
    ['NFS-e Subst.:', tag(dps, 'chSubstda')],
    ['Doc. Ref.:', tag(info, 'docRef')],
    ['Cod. Obra:', tag(obra, 'cObra')],
    ['Insc. Imob.:', tag(obra, 'inscImobFisc')],
    ['Cod. Evt.:', tag(grupo(serv, 'atvEvento'), 'idAtvEvt')],
    ['Doc. Tec.:', tag(info, 'idDocTec')],
    ['Núm. Ped.:', tag(grupo(info, 'gItemPed'), 'xPed')],
    ['Item Ped.:', tag(grupo(info, 'gItemPed'), 'xItemPed')],
    ['Inf. A. T. Mun.:', tag(info, 'xOutInf')],
  ];
  return partes.filter(([, v]) => v).map(([r, v]) => `${r} ${v}`);
}
