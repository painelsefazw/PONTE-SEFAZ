/**
 * Leitura da NFS-e autorizada.
 *
 * A SEFIN devolve o XML da nota gerada, e é dele — não do DPS que enviamos —
 * que saem número, data de processamento e os valores apurados. O município
 * pode aplicar redução, benefício ou alíquota própria, então `vISSQN` e `vLiq`
 * da resposta não são necessariamente o que calculamos antes de enviar.
 *
 * O parser é por expressão regular de propósito: o XML vem assinado, e o que
 * precisamos são campos escalares em posições fixas do `infNFSe`. Trazer um
 * parser de árvore para isso custaria uma dependência e a chance de
 * re-serializar (e invalidar) uma assinatura que só precisamos guardar.
 */

export interface NfseAutorizada {
  /** Chave de acesso — 50 dígitos. */
  chaveAcesso?: string;
  /** Número da NFS-e atribuído pelo Sistema Nacional. */
  numero?: string;
  /** Número do DFS-e. */
  numeroDfse?: string;
  /** Data e hora do processamento pela SEFIN. */
  dataProcessamento?: string;
  /** Código de status da nota. */
  status?: string;
  /** Município onde o ISSQN incide (IBGE). */
  municipioIncidencia?: string;
  /** Município emissor, por extenso, como a SEFIN devolve. */
  localEmissao?: string;
  /** Município da prestação, por extenso. */
  localPrestacao?: string;
  emitente?: { cnpj?: string; cpf?: string; razaoSocial?: string; im?: string };
  /**
   * Tomador e serviço vêm do DPS que a SEFIN devolve embutido na nota. Não
   * estão no corpo da NFS-e — quem precisar deles para o DANFSE tem que descer
   * até lá.
   */
  tomador?: { cnpj?: string; cpf?: string; razaoSocial?: string };
  servico?: {
    codigoTributacaoNacional?: string;
    descricao?: string;
    valorServico?: string;
    dataEmissao?: string;
    competencia?: string;
    serie?: string;
    numeroDps?: string;
  };
  valores: {
    /** Base de cálculo apurada. */
    baseCalculo?: string;
    /** Alíquota efetivamente aplicada pelo município. */
    aliquotaAplicada?: string;
    /** ISSQN devido. */
    issqn?: string;
    /** Total retido. */
    totalRetido?: string;
    /** Valor líquido — o que o prestador recebe. */
    liquido?: string;
  };
  /** Id do DPS que originou a nota. */
  idDps?: string;
}

/** Primeiro conteúdo da tag, ou undefined. Não desce em namespace com prefixo. */
function tag(xml: string, nome: string): string | undefined {
  const m = xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`));
  return m ? m[1] : undefined;
}

/**
 * Recorta um grupo para procurar dentro dele sem pegar tag homônima de outro.
 *
 * Aceita atributos na tag de abertura: `infNFSe` e `infDPS` carregam o `Id`, e
 * casar só `<nome>` deixaria os dois de fora — o que apaga tomador e serviço
 * sem erro nenhum, só devolvendo undefined.
 */
function grupo(xml: string, nome: string): string {
  const m = xml.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`));
  return m ? m[1] : '';
}

export function parseNfse(xml: string): NfseAutorizada {
  const inf = grupo(xml, 'infNFSe') || xml;

  // A chave vem no atributo Id do infNFSe, prefixada com 'NFS'.
  const idAttr = xml.match(/<infNFSe[^>]*\bId="([^"]+)"/);
  const chaveAcesso = idAttr ? idAttr[1].replace(/\D/g, '') : undefined;

  // emit e valores são recortados antes de ler os campos: 'CNPJ' aparece
  // também no prestador dentro do DPS embutido, e 'vBC' em outros grupos.
  const emit = grupo(inf, 'emit');
  const valores = grupo(inf, 'valores');

  const idDpsAttr = inf.match(/<infDPS[^>]*\bId="([^"]+)"/);

  // O DPS de origem vem embutido; tomador e serviço só existem lá dentro.
  const dps = grupo(inf, 'infDPS');
  const toma = grupo(dps, 'toma');
  const serv = grupo(dps, 'serv');

  return {
    chaveAcesso,
    numero: tag(inf, 'nNFSe'),
    numeroDfse: tag(inf, 'nDFSe'),
    dataProcessamento: tag(inf, 'dhProc'),
    status: tag(inf, 'cStat'),
    municipioIncidencia: tag(inf, 'cLocIncid'),
    localEmissao: tag(inf, 'xLocEmi'),
    localPrestacao: tag(inf, 'xLocPrestacao'),
    emitente: emit ? {
      cnpj: tag(emit, 'CNPJ'),
      cpf: tag(emit, 'CPF'),
      razaoSocial: tag(emit, 'xNome'),
      im: tag(emit, 'IM'),
    } : undefined,
    tomador: toma ? {
      cnpj: tag(toma, 'CNPJ'),
      cpf: tag(toma, 'CPF'),
      razaoSocial: tag(toma, 'xNome'),
    } : undefined,
    servico: dps ? {
      codigoTributacaoNacional: tag(serv, 'cTribNac'),
      descricao: tag(serv, 'xDescServ'),
      valorServico: tag(grupo(dps, 'vServPrest'), 'vServ'),
      dataEmissao: tag(dps, 'dhEmi'),
      competencia: tag(dps, 'dCompet'),
      serie: tag(dps, 'serie'),
      numeroDps: tag(dps, 'nDPS'),
    } : undefined,
    valores: {
      baseCalculo: tag(valores, 'vBC'),
      aliquotaAplicada: tag(valores, 'pAliqAplic'),
      issqn: tag(valores, 'vISSQN'),
      totalRetido: tag(valores, 'vTotalRet'),
      liquido: tag(valores, 'vLiq'),
    },
    idDps: idDpsAttr ? idDpsAttr[1] : undefined,
  };
}
