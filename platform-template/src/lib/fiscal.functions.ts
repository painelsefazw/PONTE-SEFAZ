import { createServerFn } from "@tanstack/react-start";
import { apiFetch, apiFetchArquivo, requireAuth, type ApiResult } from "./fiscal.server";
import { manifest } from "./manifest";

export type Json = string | number | boolean | null | undefined | Json[] | { [k: string]: Json };

// O projeto usa exactOptionalPropertyTypes, então cada campo opcional precisa
// admitir undefined explicitamente — o normalizador atribui undefined quando o
// backend não manda o campo.
export type DocumentoFiscal = {
  id?: string | undefined;
  numero?: string | number | undefined;
  serie?: string | number | undefined;
  chave?: string | undefined;
  status?: string | undefined;
  destinatario?: string | undefined;
  tomador?: string | undefined;
  valor?: number | undefined;
  emitidoEm?: string | undefined;
  protocolo?: string | undefined;
  cStat?: string | undefined;
  ambiente?: string | undefined;
  [key: string]: Json;
};

/** `1` produção (nota com valor fiscal), `2` homologação (ensaio). */
export type Ambiente = "1" | "2";

export type StatusFiscal = {
  online?: boolean | undefined;
  cStat?: string | undefined;
  xMotivo?: string | undefined;
  ambiente?: string | undefined;
  /** O que a credencial aceita: "ambos", "producao" ou "homologacao". */
  ambientePermitido?: string | undefined;
};

/**
 * O que a prévia devolve: a nota montada e validada contra o schema da SEFAZ,
 * sem envio e sem consumir numeração. `nfe` é exatamente o objeto que seria
 * transmitido — a tela mostra os totais dele, e não uma conta própria, para não
 * exibir um número e enviar outro.
 */
/** Correção de CFOP que o servidor aplicou, por item. */
export type CfopAjustado = { item: number; de: string; para: string };

export type PreviaNota = {
  simulacao?: boolean | undefined;
  sucesso?: boolean | undefined;
  /** Falso quando a conferência contra o schema oficial não pôde rodar. */
  schemaValidado?: boolean | undefined;
  /** O servidor acertou o sentido do CFOP destes itens. Mostre na tela. */
  cfopAjustado?: CfopAjustado[] | undefined;
  /** Defaults fiscais que o servidor aplicou por falta de informação. */
  avisos?: string[] | undefined;
  ambiente?: string | undefined;
  chaveAcesso?: string | undefined;
  numero?: string | undefined;
  serie?: string | undefined;
  nfe?: Record<string, Json> | undefined;
  xml?: string | undefined;
};

/**
 * A API não tem rotas REST por recurso. Os caminhos são por verbo e diferem
 * entre os dois serviços — inclusive o formato da listagem: NF-e devolve um
 * array direto e NFS-e devolve { notas: [...] }.
 */
const ROTAS = {
  nfe: {
    listar: "/api/historico",
    emitir: "/api/emitir",
    cancelar: "/api/cancelar",
    detalhe: (chave: string) => `/api/consultar?chave=${encodeURIComponent(chave)}`,
  },
  /**
   * NFC-e e o cupom do balcao: modelo 65.
   *
   * Compartilha historico, cancelamento e consulta com a NF-e — sao o mesmo
   * documento para a SEFAZ, mudando o modelo. So a emissao tem rota propria,
   * porque o cupom leva CSC, QR Code e numeracao em rajada.
   */
  nfce: {
    listar: "/api/historico",
    emitir: "/api/emitir-nfce",
    cancelar: "/api/cancelar",
    detalhe: (chave: string) => `/api/consultar?chave=${encodeURIComponent(chave)}`,
  },
  nfse: {
    listar: "/api/nfse/historico?limit=200",
    emitir: "/api/nfse/emitir",
    cancelar: "/api/nfse/cancelar",
    detalhe: (chave: string) => `/api/nfse/${encodeURIComponent(chave)}`,
  },
} as const;

/**
 * Converte o registro da API para o formato que as telas leem. Os nomes do
 * backend são chaveAcesso/destNome/vNF/emitidaEm — ler id/valor/dataEmissao
 * deixava a tabela cheia de "-" e R$ 0,00.
 */
/** Lê `objeto.campo` quando a API devolve o dado aninhado em vez de achatado. */
function aninhado(n: Record<string, unknown>, objeto: string, campo: string): unknown {
  const alvo = n[objeto];
  if (!alvo || typeof alvo !== "object") return undefined;
  return (alvo as Record<string, unknown>)[campo];
}

function normalizar(bruto: unknown): DocumentoFiscal {
  const n = (bruto ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
  const chave = texto(n["chaveAcesso"] ?? n["chave"]);
  const valorBruto = n["vNF"] ?? n["valorServico"] ?? aninhado(n, "servico", "valorServico") ?? n["valor"];
  const valor = valorBruto === undefined || valorBruto === null ? undefined : Number(valorBruto);

  return {
    ...(n as Record<string, Json>),
    id: chave,
    chave,
    numero: texto(n["numero"]),
    serie: texto(n["serie"]),
    status: texto(n["status"]),
    destinatario: texto(n["destNome"] ?? n["tomadorNome"] ?? aninhado(n, "tomador", "razaoSocial") ?? n["destinatario"]),
    // No DETALHE da NFS-e o tomador vem como objeto (`tomador.razaoSocial`) e o
    // valor dentro de `servico.valorServico`. `String(objeto)` imprimia
    // "[object Object]" no nome e deixava o valor em R$ 0,00 — a listagem
    // funcionava porque ali a API já devolve os campos achatados.
    tomador: texto(n["tomadorNome"] ?? aninhado(n, "tomador", "razaoSocial") ?? n["destNome"]),
    valor: Number.isFinite(valor) ? valor : undefined,
    emitidoEm: texto(n["emitidaEm"] ?? n["dhRecbto"] ?? n["emitidoEm"]),
    protocolo: texto(n["protocolo"]),
    cStat: texto(n["cStat"]),
    ambiente: texto(n["ambiente"]),
  };
}

/**
 * Campos preenchidos, para mesclar sem apagar.
 *
 * Espalhar um objeto com `undefined` por cima de outro APAGA o que havia
 * embaixo — foi assim que o detalhe zerava os dados vindos do histórico.
 */
function semVazios(o: DocumentoFiscal): Partial<DocumentoFiscal> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<DocumentoFiscal>;
}

/** Aceita array direto (NF-e) ou embrulhado em `notas` (NFS-e). */
function extrairLista(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const chave of ["notas", "servicos", "documentos", "data", "items"]) {
      const v = (raw as Record<string, unknown>)[chave];
      if (Array.isArray(v)) return v;
    }
  }
  return null;
}

export const listarDocumentos = createServerFn({ method: "POST" })
  .inputValidator((data: { tipo: "nfe" | "nfce" | "nfse"; status?: string; busca?: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<DocumentoFiscal[]>> => {
    await requireAuth();
    const res = await apiFetch<unknown>(ROTAS[data.tipo].listar);
    if (!res.ok) return res;

    const lista = extrairLista(res.data);
    // Formato inesperado é erro visível, não lista vazia silenciosa.
    if (!lista) return { ok: false, error: "A API respondeu num formato inesperado." };

    let docs = lista.map(normalizar);

    /**
     * NF-e e NFC-e dividem o mesmo historico: a API nao separa.
     *
     * Quem separa e a CHAVE de acesso — os digitos 21 e 22 sao o modelo, `55`
     * para nota de produto e `65` para cupom. Sem este filtro a lista de cupons
     * mostraria as notas de venda e vice-versa, o que numa loja que emite os
     * dois e a diferenca entre conferir o caixa do dia e conferir tudo.
     *
     * Chave curta ou ausente nao e descartada: nota que nao diz o modelo
     * aparece nas duas listas, o que e melhor que sumir de ambas.
     */
    if (data.tipo === "nfe" || data.tipo === "nfce") {
      const modeloAlvo = data.tipo === "nfce" ? "65" : "55";
      docs = docs.filter((d) => {
        const chave = String(d.chave ?? "").replace(/\D/g, "");
        if (chave.length !== 44) return true;
        return chave.slice(20, 22) === modeloAlvo;
      });
    }

    // A API não filtra por status nem por busca — aplicamos aqui.
    if (data.status && data.status !== "todos") {
      const alvo = data.status.toUpperCase();
      docs = docs.filter((d) => String(d.status ?? "").toUpperCase() === alvo);
    }
    if (data.busca?.trim()) {
      const termo = data.busca.trim().toLowerCase();
      docs = docs.filter((d) =>
        [d.numero, d.chave, d.destinatario, d.tomador]
          .some((c) => String(c ?? "").toLowerCase().includes(termo)),
      );
    }
    return { ok: true, data: docs };
  });

export const obterDocumento = createServerFn({ method: "POST" })
  .inputValidator((data: { tipo: "nfe" | "nfce" | "nfse"; id: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<DocumentoFiscal>> => {
    await requireAuth();
    const res = await apiFetch<unknown>(ROTAS[data.tipo].detalhe(data.id));
    if (!res.ok) return res;
    // A consulta pode vir embrulhada; normalizar aceita os dois casos.
    const bruto = res.data && typeof res.data === "object" && "nota" in (res.data as object)
      ? (res.data as { nota: unknown }).nota
      : res.data;
    const detalhe = normalizar(bruto);

    // /api/consultar devolve o STATUS na SEFAZ — chave, cStat, protocolo — e
    // mais nada. Sozinho, ele monta uma tela com "Nota ? / série ?" e
    // destinatário "-": o cadastro da nota mora no histórico, não na consulta.
    // Então o histórico completa o que a consulta não sabe, e a consulta vence
    // no que ela sabe melhor (o status atual na SEFAZ).
    if (data.tipo === "nfe" || data.tipo === "nfce") {
      const hist = await apiFetch<unknown>(ROTAS[data.tipo].listar);
      if (hist.ok) {
        const lista = extrairLista(hist.data) ?? [];
        const doHistorico = lista
          .map((x) => normalizar(x))
          .find((x) => x.chave === data.id);
        if (doHistorico) {
          return {
            ok: true,
            data: { ...doHistorico, ...semVazios(detalhe) },
          };
        }
      }
    }
    return { ok: true, data: detalhe };
  });

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * A classificação devolve sempre CFOP de saída (5xxx/6xxx), porque ela olha o
 * produto, não o sentido da operação. Numa nota de entrada isso sairia errado:
 * 5102 em vez de 1102. Aqui o primeiro dígito é trocado, preservando os três
 * últimos, que são a natureza da operação decidida pela classificação.
 */
function cfopNoSentido(cfop: string, entrada: boolean): string {
  const d = String(cfop ?? "").replace(/\D/g, "");
  if (d.length !== 4) return "";
  const primeiro = d[0]!;
  const paraEntrada: Record<string, string> = { "5": "1", "6": "2" };
  const paraSaida: Record<string, string> = { "1": "5", "2": "6" };
  const novo = entrada ? (paraEntrada[primeiro] ?? primeiro) : (paraSaida[primeiro] ?? primeiro);
  return novo + d.slice(1);
}

/**
 * CFOP e indIEDest andam juntos: CFOP de contribuinte com destinatário não
 * contribuinte faz a SEFAZ rejeitar pedindo a IE (cStat 232), sem dizer que a
 * causa é o CFOP. Derivamos os dois da UF e do tipo, para o operador não
 * precisar decorar código.
 *
 *  - primeiro dígito: 5 dentro do estado, 6 para fora (1 e 2 na entrada);
 *  - final: 102 para contribuinte, 108 para não contribuinte.
 */
function cfopDaOperacao(ufDestino: string, indIEDest: string, entrada = false): string {
  const dentroDoEstado = ufDestino.toUpperCase() === manifest.company.uf.toUpperCase();

  // Entrada (compra) usa a família 1xxx/2xxx e não distingue o destinatário.
  if (entrada) return dentroDoEstado ? "1102" : "2102";

  /**
   * **`5108` não existe.** Esta função devolvia `prefixo + "108"` para não
   * contribuinte, e a SEFAZ recusou com 770 (CFOP Inexistente) na primeira
   * emissão de teste — numa venda interna para consumidor, que é a venda mais
   * comum que existe no varejo.
   *
   * A distinção "destinada a não contribuinte" só existe na família 6xxx: o
   * `6108` é real porque a operação interestadual para consumidor tem regra
   * própria (é ela que gera DIFAL). Dentro do estado não há essa separação — o
   * comprador ser contribuinte ou não NÃO muda o CFOP, e a venda é `5102` nos
   * dois casos.
   *
   * O mapa de CFOP do próprio Emissor sempre soube disso: ele usa 5102/6102 e
   * não tem nenhuma variante 108. Quem inventou o par simétrico foi este
   * arquivo.
   */
  if (dentroDoEstado) return "5102";
  return indIEDest === "9" ? "6108" : "6102";
}

/** CPF tem 11 dígitos, CNPJ tem 14 — a API espera o campo certo, não os dois. */
function documento(valor: string): { cnpj?: string; cpf?: string } {
  const d = soDigitos(valor);
  return d.length === 11 ? { cpf: d } : { cnpj: d };
}


const numero = (v: unknown) => Number(String(v ?? "").replace(",", ".")) || 0;

// ─────────────────────────────────────────────────────────────────────────────
// Apoio fiscal: numeração, classificação e catálogo.
//
// A API já sabe classificar produto, resolver CFOP e numerar a nota. Sem usar
// isso o operador digita NCM e CFOP de cabeça — que é a fonte mais comum de
// nota rejeitada.
// ─────────────────────────────────────────────────────────────────────────────

export type Classificacao = {
  ncm?: string;
  descricao?: string;
  cfop?: string;
  cstCsosn?: string;
  aliqIcms?: string;
  redBcIcms?: string;
  cstIpi?: string;
  aliqIpi?: string;
  cest?: string;
  mva?: string;
  aliqIcmsSt?: string;
  temST?: boolean;
  cbenef?: string;
  baseLegal?: string;
  fonte?: string;
};

export type SugestaoNcm = { codigo: string; descricao: string; origem?: string; usos?: number };

export type ProdutoCatalogo = {
  id?: number;
  codigo?: string;
  descricao?: string;
  ncm?: string;
  cfop?: string;
  unidade?: string;
  valorUnitario?: string;
  cstCsosn?: string;
  aliqIcms?: string;
  cstIpi?: string;
  aliqIpi?: string;
  cest?: string;
  // A tela de cadastro ja pedia estes; o tipo nao os declarava, entao eles
  // chegavam do servidor e ninguem podia le-los sem o TypeScript reclamar — que
  // e por isso que a emissao nunca os aproveitou.
  origem?: string;
  ean?: string;
  redBcIcms?: string;
  mva?: string;
  aliqIcmsSt?: string;
  cbenef?: string;
  cstPis?: string;
  cstCofins?: string;
  ibscbsCst?: string;
  ibscbsCclasstrib?: string;
  ibscbsPRedAliq?: string;
};

/**
 * Próximo número da série. A API NÃO numera sozinha: sem isto toda nota sai
 * como número 1 e a segunda colide com a primeira.
 *
 * O ambiente vai junto porque a contagem é separada: pedir sem dizer qual
 * devolveria o número do outro lado.
 */
export const proximoNumero = createServerFn({ method: "POST" })
  .inputValidator((data: { serie: string; ambiente?: Ambiente | undefined }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ serie: string; numero: number }>> => {
    await requireAuth();
    const q = new URLSearchParams({
      serie: data.serie || "1",
      ambiente: data.ambiente ?? "1",
    });
    return apiFetch<{ serie: string; numero: number }>(`/api/proximo-numero?${q.toString()}`);
  });

/**
 * Situação da SEFAZ e — o que interessa para a tela de emissão — o que a
 * credencial pode fazer. Sem isso o seletor de ambiente ofereceria uma opção
 * que devolve 403, o que é pior do que não oferecer nenhuma.
 */
export type ServicoNfse = {
  id?: number | undefined;
  codigo: string;
  descricao: string;
  codigoTributacaoNacional?: string | undefined;
  /** Codigo do servico na lista da prefeitura, quando ela exige o proprio. */
  codigoTributacaoMunicipal?: string | undefined;
  /** Nomenclatura Brasileira de Servicos — o "NCM do servico". */
  codigoNBS?: string | undefined;
  valorPadrao?: string | number | undefined;
  aliquotaIss?: string | number | undefined;
  /** '1' tributavel, '2' imunidade, '3' exportacao, '4' nao incidencia. */
  tributacaoIssqn?: string | undefined;
  /** '1' = NAO retido, '2' = retido pelo tomador, '3' = pelo intermediario. */
  issRetido?: string | undefined;
  /**
   * Percentuais das retencoes FEDERAIS deste servico.
   *
   * Guardar percentual e nao valor segue o mesmo criterio do ISS: o valor muda
   * a cada nota, a aliquota e caracteristica do servico. Quem decide se retem
   * de fato e o tomador, entao isto e sugestao — a emissao calcula, mostra e
   * deixa mexer.
   */
  aliqIrrf?: string | undefined;
  aliqCsll?: string | undefined;
  aliqInss?: string | undefined;
  aliqPis?: string | undefined;
  aliqCofins?: string | undefined;
};

/**
 * O corpo da emissao de NFS-e.
 *
 * Era `Record<string, string>` — plano, so texto. As retencoes federais quebram
 * isso: `retencoes` e um grupo, e dentro dele `pisCofins` e outro. Alargar o
 * tipo com um valor solto seria abrir mao da conferencia em todos os campos.
 */
export type PayloadNfse = Record<string, string | Record<string, unknown> | undefined>;

/** As cinco retencoes federais, na ordem em que aparecem na tela. */
export const RETENCOES_FEDERAIS = [
  { campo: "aliqIrrf", valor: "valorRetidoIRRF", nome: "IRRF", dica: "Imposto de renda na fonte. 1,5% no caso mais comum." },
  { campo: "aliqCsll", valor: "valorRetidoCSLL", nome: "CSLL", dica: "1% no regime geral de retencao." },
  { campo: "aliqInss", valor: "valorRetidoINSS", nome: "INSS", dica: "Contribuicao previdenciaria (vRetCP). 11% em cessao de mao de obra." },
  { campo: "aliqPis", valor: "valorPis", nome: "PIS", dica: "0,65% quando ha retencao conjunta." },
  { campo: "aliqCofins", valor: "valorCofins", nome: "COFINS", dica: "3% quando ha retencao conjunta." },
] as const;


/**
 * Catálogo de serviços da empresa. É dele que sai o `servicoCodigo` da emissão —
 * escolher um item preenche valor, alíquota, ISS retido e tributação sozinho.
 *
 * A resposta vem embrulhada em `{ servicos: [...] }`, ao contrário do histórico
 * de NF-e, que é array direto.
 */
export const listarServicosNfse = createServerFn({ method: "POST" })
  .handler(async (): Promise<ApiResult<ServicoNfse[]>> => {
    await requireAuth();
    const res = await apiFetch<unknown>("/api/nfse/servicos");
    if (!res.ok) return res;
    const lista = extrairLista(res.data) ?? [];
    return { ok: true, data: lista as ServicoNfse[] };
  });

/**
 * Baixa o XML ou o PDF de um documento já emitido.
 *
 * O XML é o documento fiscal — o PDF é a representação gráfica dele. O cliente
 * precisa dos dois: um para a contabilidade e a escrituração, outro para
 * acompanhar a mercadoria e mostrar a quem pedir.
 *
 * Os caminhos diferem por serviço, e o da NFS-e nem se chama DANFE.
 */
const ARQUIVO = {
  nfe: {
    xml: (c: string) => `/api/nota/${c}/xml`,
    pdf: (c: string) => `/api/nota/${c}/danfe`,
    nome: (c: string, f: string) => `${f === "xml" ? "NFe" : "DANFE"}_${c}.${f}`,
  },
  // O cupom usa as MESMAS rotas de arquivo da NF-e: para a SEFAZ e o mesmo
  // documento, mudando o modelo. So o nome do arquivo muda, porque quem abre a
  // pasta de downloads precisa saber o que e cupom e o que e nota de venda.
  nfce: {
    xml: (c: string) => `/api/nota/${c}/xml`,
    pdf: (c: string) => `/api/nota/${c}/danfe`,
    nome: (c: string, f: string) => `${f === "xml" ? "NFCe" : "Cupom"}_${c}.${f}`,
  },
  nfse: {
    xml: (c: string) => `/api/nfse/${c}/xml`,
    pdf: (c: string) => `/api/nfse/${c}/danfse`,
    nome: (c: string, f: string) => `${f === "xml" ? "NFSe" : "DANFSE"}_${c}.${f}`,
  },
} as const;

export const baixarDocumento = createServerFn({ method: "POST" })
  .inputValidator((data: { tipo: "nfe" | "nfce" | "nfse"; chave: string; formato: "xml" | "pdf" }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ nome: string; base64: string; tipo: string }>> => {
    await requireAuth();
    const chave = soDigitos(data.chave);
    if (!chave) return { ok: false, error: "Chave de acesso invalida." };

    const cfg = ARQUIVO[data.tipo];
    const res = await apiFetchArquivo(cfg[data.formato](chave));
    if (!res.ok) return res;

    return {
      ok: true,
      data: {
        nome: cfg.nome(chave, data.formato),
        base64: res.data.base64,
        // O tipo vem da API; o fallback cobre resposta sem cabeçalho.
        tipo: res.data.tipo || (data.formato === "xml" ? "application/xml" : "application/pdf"),
      },
    };
  });

/**
 * Uma nota anterior, no formato do FORMULARIO.
 *
 * Campos opcionais um por um, em vez de `Record<string, unknown>`: com indice
 * generico o TypeScript exige `d["itens"]` e, pior, aceita `d.itens` escrito
 * errado sem reclamar — o campo viria `undefined` e o formulario abriria vazio
 * sem dizer por que.
 */
export type ItemDuplicado = {
  codigo?: string; descricao?: string; ncm?: string; unidade?: string;
  quantidade?: string | number; valorUnitario?: string | number; desconto?: string | number;
  cfop?: string; cstIcms?: string; aliqIcms?: string; cstIpi?: string; aliqIpi?: string;
  cest?: string; origem?: string; redBcIcms?: string; mva?: string; aliqIcmsSt?: string;
  ibscbsCst?: string; ibscbsCclasstrib?: string; ibscbsPRedAliq?: string;
};

export type NotaDuplicada = {
  destinatario?: {
    razaoSocial?: string; cnpj?: string; cpf?: string; email?: string;
    indIEDest?: string; ie?: string;
    endereco?: {
      logradouro?: string; numero?: string; bairro?: string;
      municipio?: string; nomeMunicipio?: string; codigoMunicipio?: string;
      uf?: string; cep?: string;
    };
  };
  itens?: ItemDuplicado[];
  pagamento?: { formas?: Array<{ tipo?: string; valor?: string }>; troco?: string };
  naturezaOperacao?: string;
  tipoOperacao?: string;
  informacoesAdicionais?: { complementar?: string; fisco?: string };
  /** Numero e serie da nota de ORIGEM. Nao se reaproveita: viraria duplicidade. */
  origem?: { numero?: string; serie?: string };
};

/**
 * Dados de uma nota anterior, prontos para preencher o formulario.
 *
 * Existe para o caso mais comum de todos: a nota saiu em teste, foi conferida, e
 * agora precisa sair valendo. Sem isto o operador redigita destinatario, itens e
 * pagamento — e o erro que ele acabou de corrigir volta na digitacao.
 *
 * A API devolve os campos no formato do FORMULARIO, nao do XML: quem converte e
 * ela, porque so ela sabe desfazer o que a montagem fez (grupo de ICMS de volta
 * para CST e aliquota, endereco de volta para campos).
 */
export const duplicarDocumento = createServerFn({ method: "POST" })
  .inputValidator((data: { chave: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<NotaDuplicada>> => {
    await requireAuth();
    const chave = soDigitos(data.chave);
    if (!chave) return { ok: false, error: "Chave de acesso invalida." };
    const res = await apiFetch<NotaDuplicada>(`/api/nota/${chave}/duplicar`);
    if (!res.ok) return res;
    // A API embrulha em { nota: ... } em algumas versoes.
    const bruto = res.data as NotaDuplicada & { nota?: NotaDuplicada };
    return { ok: true, data: bruto?.nota ?? bruto };
  });

/**
 * Apaga UMA nota de teste do historico.
 *
 * A API recusa nota de producao, e isso e proposito dela, nao esquecimento
 * daqui: o historico e onde vive o XML autorizado, e apagar de la nao desfaz a
 * nota na SEFAZ — deixa a empresa sem o arquivo de uma nota que existe.
 */
export const apagarDocumento = createServerFn({ method: "POST" })
  .inputValidator((data: { chave: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ removidas: number }>> => {
    await requireAuth();
    const chave = soDigitos(data.chave);
    if (!chave) return { ok: false, error: "Chave de acesso invalida." };
    const res = await apiFetch<{ removidas?: number }>(`/api/nota/${chave}`, { method: "DELETE" });
    return res.ok ? { ok: true, data: { removidas: res.data?.removidas ?? 0 } } : res;
  });

/** Apaga TODAS as notas de teste desta empresa. Producao nunca entra. */
export const limparTestes = createServerFn({ method: "POST" })
  .handler(async (): Promise<ApiResult<{ removidas: number }>> => {
    await requireAuth();
    const res = await apiFetch<{ removidas?: number }>("/api/notas/homologacao", { method: "DELETE" });
    return res.ok ? { ok: true, data: { removidas: res.data?.removidas ?? 0 } } : res;
  });

export const statusFiscal = createServerFn({ method: "POST" })
  .handler(async (): Promise<ApiResult<StatusFiscal>> => {
    await requireAuth();
    return apiFetch<StatusFiscal>("/api/status");
  });

/** Classificação fiscal a partir do NCM: devolve CFOP, CST, alíquotas prontos. */
export const classificarNcm = createServerFn({ method: "POST" })
  .inputValidator((data: {
    ncm: string;
    uf?: string | undefined;
    operacao?: string | undefined;
    entrada?: boolean | undefined;
    interestadual?: boolean | undefined;
  }) => data)
  .handler(async ({ data }): Promise<ApiResult<Classificacao>> => {
    await requireAuth();
    const ncm = soDigitos(data.ncm);
    if (ncm.length !== 8) return { ok: false, error: "Informe o NCM com 8 digitos." };
    const q = new URLSearchParams({ ncm });
    if (data.uf) q.set("uf", data.uf.toUpperCase());
    if (data.operacao) q.set("operacao", data.operacao);
    // O sentido vai em parametro proprio: `operacao` nomeia a natureza. Sem
    // isto a classificacao devolve 5102 (saida) para uma nota de entrada, e a
    // SEFAZ recusa com cStat 519.
    if (data.entrada) q.set("entrada", "1");
    if (data.interestadual) q.set("interestadual", "1");
    return apiFetch<Classificacao>(`/api/classificar?${q.toString()}`);
  });

/** Autocomplete de NCM pela descrição do produto. */
export const buscarNcm = createServerFn({ method: "POST" })
  .inputValidator((data: { termo: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<SugestaoNcm[]>> => {
    await requireAuth();
    const termo = (data.termo || "").trim();
    if (termo.length < 3) return { ok: true, data: [] };
    const res = await apiFetch<{ itens?: SugestaoNcm[] }>(
      `/api/ncm/buscar?q=${encodeURIComponent(termo)}`,
    );
    if (!res.ok) return res;
    // A rota devolve { disponivel, fonte, itens: [...] } — embrulhado.
    return { ok: true, data: Array.isArray(res.data?.itens) ? res.data.itens : [] };
  });

/** Catálogo de produtos da própria empresa — escolher preenche o item inteiro. */
export const buscarProdutos = createServerFn({ method: "POST" })
  .inputValidator((data: { termo: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<ProdutoCatalogo[]>> => {
    await requireAuth();
    const termo = (data.termo || "").trim();
    if (termo.length < 2) return { ok: true, data: [] };
    const res = await apiFetch<ProdutoCatalogo[]>(`/api/produtos?q=${encodeURIComponent(termo)}`);
    if (!res.ok) return res;
    return { ok: true, data: Array.isArray(res.data) ? res.data : [] };
  });

export type ItemNota = {
  codigo?: string | undefined;
  descricao: string;
  ncm: string;
  unidade?: string | undefined;
  quantidade: string;
  valorUnitario: string;
  desconto?: string | undefined;
  cfop?: string | undefined;
  cstIcms?: string | undefined;
  aliqIcms?: string | undefined;
  cstIpi?: string | undefined;
  aliqIpi?: string | undefined;
  cest?: string | undefined;
  // Campos que MUDAM IMPOSTO e que a classificacao ja devolve. Sem eles no
  // corpo, a reducao de base, a ST e a origem eram descartadas depois de terem
  // sido consultadas — a tela mostrava o tratamento certo e a nota ia sem ele.
  origem?: string | undefined;
  cBenef?: string | undefined;
  redBcIcms?: string | undefined;
  mva?: string | undefined;
  aliqIcmsSt?: string | undefined;
  pICMSUFDest?: string | undefined;
  pFCPUFDest?: string | undefined;
  // IBS/CBS. Esta lista é branca: campo que não está aqui não chega na API, e
  // era exatamente o que acontecia com estes três — não havia como emitir um
  // produto de alíquota zero pelo site, e toda nota afirmava tributação
  // integral. Vazio continua caindo no padrão do motor (CST 000 / 000001).
  ibscbsCst?: string | undefined;
  ibscbsCclasstrib?: string | undefined;
  ibscbsPRedAliq?: string | undefined;
};

export type NotaNfe = {
  serie?: string | undefined;
  numero?: string | undefined;
  tipoOperacao?: string | undefined;
  naturezaOperacao?: string | undefined;
  /** 1 normal, 2 complementar, 3 ajuste, 4 devolucao. */
  finalidade?: string | undefined;
  /** Chaves das notas de origem. Exigidas na complementar e na devolucao. */
  notasReferenciadas?: string[] | undefined;
  destinatario: {
    nome: string;
    documento: string;
    email?: string | undefined;
    tipo?: string | undefined;
    ie?: string | undefined;
    logradouro: string;
    numero?: string | undefined;
    bairro: string;
    municipio: string;
    codigoMunicipio: string;
    uf: string;
    cep: string;
  };
  itens: ItemNota[];
  desconto?: string | undefined;
  formaPagamento?: string | undefined;
  observacoes?: string | undefined;
};

/**
 * Venda de balcao.
 *
 * NAO reaproveita `NotaNfe` de proposito: aquele tipo exige endereco completo do
 * destinatario, e no balcao nao existe cliente cadastrado — existe, no maximo,
 * um CPF que a pessoa pede na hora. Forcar o cupom pelo formato da NF-e faria a
 * tela pedir logradouro, bairro e CEP de quem esta comprando um refrigerante.
 */
export type CupomBalcao = {
  serie?: string | undefined;
  /** So digitos. Vazio = consumidor nao identificado, que e o caso normal. */
  cpf?: string | undefined;
  itens: ItemNota[];
  /** 01 dinheiro, 03 credito, 04 debito, 17 PIX. */
  formaPagamento: string;
  /** Quanto o cliente entregou. So faz sentido em dinheiro; gera o troco. */
  valorRecebido?: string | undefined;
};

/**
 * Corpo do cupom para `/api/emitir-nfce`.
 *
 * O troco vai calculado daqui: a API confere que o pagamento fecha com o total
 * da nota, e mandar o valor recebido sem o troco faz a soma dar diferente do
 * total — rejeicao 610, depois de transmitir.
 */
function corpoNfce(c: CupomBalcao, ambiente?: Ambiente): Record<string, unknown> {
  const total = c.itens.reduce(
    (soma, it) => soma + numero(it.quantidade) * numero(it.valorUnitario),
    0,
  );
  const recebido = numero(c.valorRecebido);
  const emDinheiro = c.formaPagamento === "01";
  const troco = emDinheiro && recebido > total ? recebido - total : 0;
  const cpf = soDigitos(c.cpf);

  return {
    // 880 e a serie reservada a plataforma. O contador da SEFAZ e por (CNPJ,
    // serie): usar a serie do sistema proprio do cliente faria os dois
    // disputarem numeracao e sairiam cupons com o mesmo numero.
    serie: c.serie || "881",
    // Sem `numero`: a API reserva o proximo da serie. No balcao isso importa
    // mais que em qualquer lugar — a venda sai em rajada, e dois caixas pedindo
    // numero ao mesmo tempo receberiam o mesmo se a tela escolhesse.
    ...(cpf ? { destinatario: { cpf } } : {}),
    itens: c.itens.map((it) => ({
      codigo: it.codigo || undefined,
      descricao: it.descricao,
      ncm: soDigitos(it.ncm),
      // Modelo 65 so existe como venda dentro do estado: o primeiro digito e 5
      // por definicao. O servidor corrige o que vier diferente, mas mandar certo
      // evita o aviso de ajuste em toda venda.
      cfop: cfopNoSentido(it.cfop ?? "5102", false),
      unidade: it.unidade || "UN",
      quantidade: it.quantidade,
      valorUnitario: it.valorUnitario,
      desconto: it.desconto || undefined,
      cstIcms: it.cstIcms || undefined,
      aliqIcms: it.aliqIcms || undefined,
      cest: it.cest || undefined,
      origem: it.origem || undefined,
      redBcIcms: it.redBcIcms || undefined,
      mva: it.mva || undefined,
      aliqIcmsSt: it.aliqIcmsSt || undefined,
      ...(it.ibscbsCst
        ? {
            ibscbs: {
              cst: it.ibscbsCst,
              cClassTrib: it.ibscbsCclasstrib || undefined,
              pRedAliq: it.ibscbsPRedAliq || undefined,
            },
          }
        : {}),
    })),
    pagamento: {
      forma: c.formaPagamento,
      valor: (emDinheiro && recebido > 0 ? recebido : total).toFixed(2),
      ...(troco > 0 ? { troco: troco.toFixed(2) } : {}),
    },
    ...(ambiente ? { ambiente } : {}),
  };
}

/**
 * O formulário coleta campos amigáveis; a API espera objetos aninhados. A
 * tradução acontece aqui, no servidor, para a tela não precisar conhecer o
 * formato do XML.
 *
 * Prévia e emissão passam pela mesma função de propósito: se cada uma montasse
 * o seu corpo, a nota conferida na tela poderia diferir da que sai — e o único
 * momento em que essa diferença aparece é depois de já ter valor fiscal.
 */
function corpoNfe(n: NotaNfe): Record<string, unknown> {
  const d = n.destinatario;
  const indIEDest = d.tipo || "9";
  const entrada = n.tipoOperacao === "0";
  const uf = (d.uf || "").toUpperCase();

  const total = n.itens.reduce(
    (soma, it) => soma + numero(it.quantidade) * numero(it.valorUnitario),
    0,
  );
  const descontoTotal =
    n.itens.reduce((soma, it) => soma + numero(it.desconto), 0) + numero(n.desconto);

  return {
    serie: n.serie || "1",
    // A API não numera sozinha: sem `numero` toda nota sai como a de nº 1.
    ...(n.numero ? { numero: String(n.numero) } : {}),
    tipoOperacao: entrada ? "0" : "1",
    naturezaOperacao:
      n.naturezaOperacao || (entrada ? "Compras para comercializacao" : "Venda de mercadoria"),
    // Finalidade e nota de origem: a lista branca daqui e o que decide o que
    // chega na API, e estes dois nao estavam nela — a devolucao (finalidade 4
    // com a chave da nota original) era impossivel pelo site.
    ...(n.finalidade && n.finalidade !== "1" ? { finalidade: n.finalidade } : {}),
    ...(n.notasReferenciadas?.length
      ? { notasReferenciadas: n.notasReferenciadas.map((c) => soDigitos(c)).filter(Boolean) }
      : {}),
    destinatario: {
      razaoSocial: d.nome,
      ...documento(d.documento ?? ""),
      email: d.email || undefined,
      indIEDest,
      // Só contribuinte tem IE; nos demais o campo nem vai.
      ie: indIEDest === "1" ? soDigitos(d.ie) || undefined : undefined,
      endereco: {
        logradouro: d.logradouro,
        numero: d.numero || "S/N",
        bairro: d.bairro,
        codigoMunicipio: soDigitos(d.codigoMunicipio),
        nomeMunicipio: d.municipio,
        uf,
        cep: soDigitos(d.cep),
      },
    },
    itens: n.itens.map((it) => ({
      codigo: it.codigo || undefined,
      descricao: it.descricao,
      ncm: soDigitos(it.ncm),
      // A classificação preenche o CFOP; sem ela derivamos pela UF e pelo
      // tipo de destinatário, que é o par que a SEFAZ confere.
      cfop: cfopNoSentido(it.cfop ?? "", entrada) || cfopDaOperacao(uf, indIEDest, entrada),
      unidade: it.unidade || "UN",
      quantidade: it.quantidade,
      valorUnitario: it.valorUnitario,
      desconto: it.desconto || undefined,
      cstIcms: it.cstIcms || undefined,
      aliqIcms: it.aliqIcms || undefined,
      cstIpi: it.cstIpi || undefined,
      aliqIpi: it.aliqIpi || undefined,
      cest: it.cest || undefined,
      origem: it.origem || undefined,
      cBenef: it.cBenef || undefined,
      redBcIcms: it.redBcIcms || undefined,
      mva: it.mva || undefined,
      aliqIcmsSt: it.aliqIcmsSt || undefined,
      pICMSUFDest: it.pICMSUFDest || undefined,
      pFCPUFDest: it.pFCPUFDest || undefined,
      // A API recebe o grupo aninhado; só o monta quando há CST, senão o motor
      // aplica a tributação integral, que é o caso da maioria dos produtos.
      ...(it.ibscbsCst
        ? {
            ibscbs: {
              cst: it.ibscbsCst,
              cClassTrib: it.ibscbsCclasstrib || undefined,
              pRedAliq: it.ibscbsPRedAliq || undefined,
            },
          }
        : {}),
    })),
    // Desconto da nota inteira: a API rateia entre os itens.
    desconto: n.desconto || undefined,
    pagamento: {
      forma: n.formaPagamento || "01",
      valor: Math.max(0, total - descontoTotal).toFixed(2),
    },
    informacoesAdicionais: n.observacoes || undefined,
  };
}

/**
 * Prévia: monta a nota, valida contra o schema da SEFAZ e devolve — sem emitir
 * e sem gastar número da série. É o que o operador aperta antes de assumir o
 * documento, e pode apertar quantas vezes quiser.
 */
export const previaNota = createServerFn({ method: "POST" })
  .inputValidator((data: { nota: NotaNfe; ambiente?: Ambiente | undefined }) => data)
  .handler(async ({ data }): Promise<ApiResult<PreviaNota>> => {
    await requireAuth();
    const corpo = { ...corpoNfe(data.nota), ambiente: data.ambiente ?? "1", simular: true };
    // Reprovação vem como `sucesso: false` com os detalhes do schema, e o
    // apiFetch já a converte em erro legível — é justamente o que se quer ver.
    return apiFetch<PreviaNota>(ROTAS.nfe.emitir, { method: "POST", body: corpo });
  });

/**
 * Corpo da NFS-e, compartilhado pela prévia e pela emissão.
 *
 * Estava embutido dentro do handler de emissão, e por isso a prévia — quando
 * passou a existir — teria de repetir a montagem. Duas cópias da mesma regra
 * divergem: foi assim que a prévia da NF-e chegou a mostrar uma nota diferente
 * da que era enviada.
 */
function corpoNfse(bruto: PayloadNfse, ambiente?: Ambiente): Record<string, unknown> {
  // `retencoes` e o unico campo aninhado do corpo; o resto continua texto. Sai
  // daqui para o restante da funcao poder tratar `p` como o mapa plano que
  // sempre foi, em vez de espalhar conversao de tipo por vinte linhas.
  const retencoes = bruto["retencoes"];
  const p: Record<string, string> = Object.fromEntries(
    Object.entries(bruto)
      .filter(([k, valor]) => k !== "retencoes" && typeof valor === "string")
      .map(([k, valor]) => [k, valor as string]),
  );
    // `servico` é um OBJETO com `codigoTributacaoNacional` (6 dígitos), e
    // `servicoCodigo` é o código do CATÁLOGO da empresa — não o item da LC 116.
    // Esta função mandava a descrição como texto em `servico` e um código da lei
    // em `servicoCodigo`: as duas coisas erradas, e nenhuma NFS-e saía.
  const doCatalogo = (p["servicoCodigo"] ?? "").trim();
  return {
    tomador: {
      razaoSocial: p["tomadorNome"],
      ...documento(p["tomadorDocumento"] ?? ""),
      email: p["tomadorEmail"] || undefined,
      // Endereço do tomador: obrigatório quando o ISS é retido (rejeição
      // E0237). A tela oferecia a retenção e não tinha onde informar o
      // endereço — quem escolhesse "retido" batia num erro sem saída.
      ...(p["tomadorLogradouro"] || p["tomadorCep"]
        ? {
            endereco: {
              logradouro: p["tomadorLogradouro"] || "",
              numero: p["tomadorNumeroEnd"] || "S/N",
              bairro: p["tomadorBairro"] || "",
              codigoMunicipio: soDigitos(p["tomadorCodigoMunicipio"] ?? ""),
              nomeMunicipio: p["tomadorMunicipio"] || "",
              uf: (p["tomadorUf"] || "").toUpperCase(),
              cep: soDigitos(p["tomadorCep"] ?? ""),
            },
          }
        : {}),
    },
    ...(doCatalogo
      ? { servicoCodigo: doCatalogo }
      : {
          servico: {
            codigoTributacaoNacional: soDigitos(p["codigoTributacaoNacional"] ?? ""),
            descricao: p["servicoDescricao"] || "Prestacao de servico",
            ...(p["codigoTributacaoMunicipal"]
              ? { codigoTributacaoMunicipal: soDigitos(p["codigoTributacaoMunicipal"]) }
              : {}),
          },
        }),
    valorServico: numero(p["valorServico"] ?? "0"),
    // Do catálogo vêm alíquota, ISS retido e tributação; sobrescrever com zero
    // apagaria justamente o que ele existe para guardar.
    ...(p["aliquota"] ? { aliquotaIss: numero(p["aliquota"]) } : {}),
    // A API espera a STRING '1'|'2'|'3', nao booleano — e '1' e NAO retido.
    // Convertendo para booleano, "Retido" virava `true`, que a API
    // transformava em "true" e recusava; e "Nao retido" virava `false`, que
    // acertava por acaso. Passa como veio.
    ...(p["issRetido"] ? { issRetido: p["issRetido"] } : {}),
    observacoes: p["observacoes"] || undefined,
    // Retencoes federais: IRRF, CSLL, INSS e o grupo de PIS/COFINS. Vao so
    // quando ha algum valor — grupo vazio no XML e recusado.
    ...(retencoes && typeof retencoes === "object" ? { retencoes } : {}),
    // Sempre explicito: sem o campo, o servidor cai no ambiente do CADASTRO
    // da empresa — e uma nota de teste sairia parecendo valida.
    ambiente: ambiente ?? p["ambiente"] ?? "1",
  };
}

export const emitirDocumento = createServerFn({ method: "POST" })
  .inputValidator(
    (
      data:
        | { tipo: "nfe"; nota: NotaNfe; ambiente?: Ambiente | undefined }
        | { tipo: "nfce"; cupom: CupomBalcao; ambiente?: Ambiente | undefined }
        | { tipo: "nfse"; payload: PayloadNfse; ambiente?: Ambiente | undefined },
    ) => data,
  )
  .handler(async ({ data }): Promise<ApiResult<DocumentoFiscal>> => {
    await requireAuth();

    if (data.tipo === "nfce") {
      const res = await apiFetch<unknown>(ROTAS.nfce.emitir, {
        method: "POST",
        body: corpoNfce(data.cupom, data.ambiente),
      });
      if (!res.ok) return res;
      // O QR Code so existe no cupom, e e por ele que o consumidor confere a
      // nota dele. `normalizar` nao o conhece, entao ele viaja a parte.
      const doc = normalizar(res.data) as Record<string, unknown>;
      const bruto = res.data as Record<string, unknown> | null;
      if (bruto && typeof bruto["qrCode"] === "string") doc["qrCode"] = bruto["qrCode"];
      return { ok: true, data: doc as DocumentoFiscal };
    }

    if (data.tipo === "nfe") {
      const corpo = { ...corpoNfe(data.nota), ambiente: data.ambiente ?? "1" };
      const res = await apiFetch<unknown>(ROTAS.nfe.emitir, { method: "POST", body: corpo });
      return res.ok ? { ok: true, data: normalizar(res.data) } : res;
    }

    const corpo = corpoNfse(data.payload, data.ambiente);
    const res = await apiFetch<unknown>(ROTAS.nfse.emitir, { method: "POST", body: corpo });
    return res.ok ? { ok: true, data: normalizar(res.data) } : res;
  });

/**
 * Prévia da NFS-e: monta a DPS e devolve sem transmitir.
 *
 * Só a NF-e tinha prévia. Na NFS-e o operador só descobria o erro emitindo — e
 * NFS-e emitida errada não se corrige por carta, só substituindo, o que a torna
 * justamente o documento em que conferir antes vale MAIS, e não menos.
 */
export const previaNfse = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { payload: PayloadNfse; ambiente?: Ambiente | undefined }) => data,
  )
  .handler(async ({ data }): Promise<ApiResult<Json>> => {
    await requireAuth();
    const res = await apiFetch<Json>(ROTAS.nfse.emitir, {
      method: "POST",
      body: { ...corpoNfse(data.payload, data.ambiente), simular: true },
    });
    return res;
  });

export const cancelarDocumento = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      // O cupom cancela pela MESMA rota da NF-e: e o mesmo evento 110111 para a
      // SEFAZ. So o prazo muda na pratica — 30 minutos na NFC-e contra 24 horas
      // na NF-e —, e disso quem avisa e a propria SEFAZ na recusa.
      tipo: "nfe" | "nfce" | "nfse";
      id: string;
      protocolo?: string | undefined;
      justificativa: string;
      ambiente?: Ambiente | undefined;
    }) => data,
  )
  .handler(async ({ data }): Promise<ApiResult<DocumentoFiscal>> => {
    await requireAuth();
    // O cancelamento é POST numa rota fixa, com a chave no corpo — não é
    // DELETE nem POST em /:id/cancelar.
    //
    // `ambiente` vai explícito porque, sem ele, o servidor cai no ambiente do
    // CADASTRO da empresa — e não no da NOTA que está na tela. Cancelar uma nota
    // de homologação com a empresa cadastrada em produção manda o evento para o
    // ambiente errado, e ele volta como "nota não encontrada". A emissão já
    // mandava sempre; o cancelamento ficou para trás.
    const res = await apiFetch<unknown>(ROTAS[data.tipo].cancelar, {
      method: "POST",
      body: {
        chaveAcesso: data.id,
        protocolo: data.protocolo,
        justificativa: data.justificativa,
        ...(data.ambiente ? { ambiente: data.ambiente } : {}),
      },
    });
    return res.ok ? { ok: true, data: normalizar(res.data) } : res;
  });

/**
 * Carta de correção (CC-e, evento 110110).
 *
 * É a única forma de consertar uma nota já autorizada sem cancelar: erro de
 * endereço, de descrição, de dado cadastral. **Não** serve para valor, imposto,
 * quantidade, data de emissão nem para trocar o destinatário — isso a SEFAZ
 * recusa, e o certo ali é cancelar e emitir de novo.
 *
 * A sequência importa: cada carta da mesma nota precisa de um `nSeqEvento`
 * maior, e a última substitui as anteriores. Por isso o texto tem de vir
 * COMPLETO a cada envio, e não só a parte nova.
 */
export const cartaCorrecao = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      chave: string;
      correcao: string;
      sequencia?: number | undefined;
      ambiente?: Ambiente | undefined;
    }) => data,
  )
  .handler(async ({ data }): Promise<ApiResult<Json>> => {
    await requireAuth();
    // A SEFAZ exige 15 caracteres. Barrar aqui evita a ida e a rejeição.
    if (data.correcao.trim().length < 15) {
      return { ok: false, error: "A correcao deve ter ao menos 15 caracteres." };
    }
    return apiFetch<Json>("/api/carta-correcao", {
      method: "POST",
      body: {
        chaveAcesso: data.chave,
        correcao: data.correcao.trim(),
        nSeqEvento: data.sequencia ?? 1,
        // Mesmo motivo do cancelamento: o ambiente é o da NOTA, não o do
        // cadastro da empresa.
        ...(data.ambiente ? { ambiente: data.ambiente } : {}),
      },
    });
  });

export const inutilizarNumeracao = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      serie: string;
      numeroInicial: string;
      numeroFinal: string;
      justificativa: string;
      ambiente?: Ambiente | undefined;
    }) => data,
  )
  .handler(async ({ data }): Promise<ApiResult<Json>> => {
    await requireAuth();
    // A rota exige nNFIni/nNFFin. numeroInicial/numeroFinal é recusado.
    return apiFetch<Json>("/api/inutilizar", {
      method: "POST",
      body: {
        serie: data.serie,
        nNFIni: data.numeroInicial,
        nNFFin: data.numeroFinal,
        justificativa: data.justificativa,
        // Mesma razão do cancelamento: inutilizar numeração no ambiente errado
        // queima números que continuam livres onde importa.
        ...(data.ambiente ? { ambiente: data.ambiente } : {}),
      },
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de produtos e regras fiscais da empresa.
//
// São os dois lugares onde o cliente ensina o sistema: o produto guarda a
// classificação de um item concreto, a regra vale para todo NCM. Ajustar aqui
// evita corrigir item a item em toda nota.
// ─────────────────────────────────────────────────────────────────────────────

export type RegraFiscal = {
  id?: number;
  ncm?: string;
  uf?: string;
  descricao?: string;
  cstIcmsNormal?: string;
  csosnSimples?: string;
  cfopSaida?: string;
  aliqIcms?: string;
  redBcIcms?: string;
  cstIpi?: string;
  aliqIpi?: string;
  cest?: string;
  mva?: string;
  aliqIcmsSt?: string;
  cbenef?: string;
  baseLegal?: string;
  /** Vazio = regra geral do sistema; preenchido = regra desta empresa. */
  empresaCnpj?: string | null;
};

export const listarProdutos = createServerFn({ method: "POST" })
  .inputValidator((data: { termo?: string | undefined }) => data)
  .handler(async ({ data }): Promise<ApiResult<ProdutoCatalogo[]>> => {
    await requireAuth();
    const q = (data.termo ?? "").trim();
    const res = await apiFetch<ProdutoCatalogo[]>(
      q ? `/api/produtos?q=${encodeURIComponent(q)}` : "/api/produtos",
    );
    if (!res.ok) return res;
    return { ok: true, data: Array.isArray(res.data) ? res.data : [] };
  });

/**
 * Correção de sentido que a API aplicou ao gravar o CFOP.
 *
 * O catálogo guarda o CFOP da VENDA. Quem cadastra copiando da nota de compra
 * digita 1102, e o campo aceitava — a emissão consertava sozinha e o cadastro
 * ficava errado para sempre, mostrando um CFOP diferente do que saía na nota.
 * A API passou a corrigir na gravação; esconder isso aqui repetiria o defeito
 * de outro jeito, porque a pessoa digitaria 1102 de novo no próximo produto.
 */
export type CfopCorrigido = { de: string; para: string };

export const salvarProduto = createServerFn({ method: "POST" })
  .inputValidator((data: { produto: Record<string, string> }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ produto: ProdutoCatalogo; cfopAjustado?: CfopCorrigido }>> => {
    await requireAuth();
    const p = data.produto;
    if (!p["descricao"]?.trim() || !soDigitos(p["ncm"])) {
      return { ok: false, error: "Descricao e NCM sao obrigatorios." };
    }
    const res = await apiFetch<{ produto?: ProdutoCatalogo; cfopAjustado?: CfopCorrigido }>("/api/produtos", {
      method: "POST",
      body: { ...p, ncm: soDigitos(p["ncm"]) },
    });
    if (!res.ok) return res;
    // A rota responde { sucesso, produto } — embrulhado.
    return {
      ok: true,
      data: {
        produto: (res.data?.produto ?? {}) as ProdutoCatalogo,
        ...(res.data?.cfopAjustado ? { cfopAjustado: res.data.cfopAjustado } : {}),
      },
    };
  });

export const removerProduto = createServerFn({ method: "POST" })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ sucesso?: boolean }>> => {
    await requireAuth();
    return apiFetch<{ sucesso?: boolean }>(`/api/produtos/${data.id}`, { method: "DELETE" });
  });

export const listarRegras = createServerFn({ method: "POST" })
  .inputValidator((data: { uf: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<RegraFiscal[]>> => {
    await requireAuth();
    const uf = (data.uf || manifest.company.uf || "SP").toUpperCase();
    const res = await apiFetch<RegraFiscal[]>(`/api/regras-fiscais?uf=${encodeURIComponent(uf)}`);
    if (!res.ok) return res;
    return { ok: true, data: Array.isArray(res.data) ? res.data : [] };
  });

export const salvarRegra = createServerFn({ method: "POST" })
  .inputValidator((data: { regra: Record<string, string> }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ regra: RegraFiscal; cfopAjustado?: CfopCorrigido }>> => {
    await requireAuth();
    const r = data.regra;
    if (!soDigitos(r["ncm"]) || !r["uf"]?.trim()) {
      return { ok: false, error: "NCM e UF sao obrigatorios." };
    }
    const res = await apiFetch<{ regra?: RegraFiscal; cfopAjustado?: CfopCorrigido }>("/api/regras-fiscais", {
      method: "POST",
      body: { ...r, ncm: soDigitos(r["ncm"]), uf: r["uf"].toUpperCase() },
    });
    if (!res.ok) return res;
    return {
      ok: true,
      data: {
        regra: (res.data?.regra ?? {}) as RegraFiscal,
        ...(res.data?.cfopAjustado ? { cfopAjustado: res.data.cfopAjustado } : {}),
      },
    };
  });

export const removerRegra = createServerFn({ method: "POST" })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ sucesso?: boolean }>> => {
    await requireAuth();
    // Regra geral responde 404: a mensagem da API ja explica o escopo.
    return apiFetch<{ sucesso?: boolean }>(`/api/regras-fiscais/${data.id}`, { method: "DELETE" });
  });

// ---------------------------------------------------------------------------
// Radar — as NFS-e que a empresa RECEBEU
// ---------------------------------------------------------------------------

/**
 * O Ambiente Nacional guarda toda NFS-e em que a empresa aparece — inclusive as
 * que ela nunca viu.
 *
 * As telas de NFS-e desta plataforma mostram o que a empresa EMITIU. Falta a
 * outra metade: a nota que o contador precisa para escriturar despesa e para
 * tomar crédito é a que um fornecedor emitiu CONTRA ela, e essa não passa por
 * aqui — chega por e-mail, por WhatsApp, ou não chega. O que não chega vira
 * despesa sem documento no fechamento do mês.
 *
 * O ADN entrega essas notas com o XML autorizado, pelo certificado da própria
 * empresa. Não é uma listagem a mais: é a origem de um documento que hoje se
 * persegue à mão.
 *
 * Só existe em produção, e é assim no servidor também: a base do ambiente
 * restrito é de ensaio e não tem nota real nenhuma.
 */
const RADAR = {
  listar: "/api/nfse/distribuicao?limit=200",
  buscar: "/api/nfse/distribuicao",
  xml: (chave: string) => `/api/nfse/distribuicao/${encodeURIComponent(chave)}/xml`,
} as const;

export type NotaRecebida = {
  chaveAcesso: string;
  nsu?: number | undefined;
  numero?: string | undefined;
  emitenteCnpj?: string | undefined;
  emitenteNome?: string | undefined;
  tomadorNome?: string | undefined;
  descricaoServico?: string | undefined;
  valorServico?: number | undefined;
  valorLiquido?: number | undefined;
  localEmissao?: string | undefined;
  emitidaEm?: string | undefined;
};

function normalizarRecebida(bruto: unknown): NotaRecebida {
  const n = (bruto ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
  const numero = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));
  return {
    chaveAcesso: String(n["chaveAcesso"] ?? n["chave_acesso"] ?? ""),
    nsu: numero(n["nsu"]),
    numero: texto(n["numero"]),
    emitenteCnpj: texto(n["emitenteCnpj"] ?? n["emitente_cnpj"]),
    emitenteNome: texto(n["emitenteNome"] ?? n["emitente_nome"]),
    tomadorNome: texto(n["tomadorNome"] ?? n["tomador_nome"]),
    descricaoServico: texto(n["descricaoServico"] ?? n["descricao_servico"]),
    valorServico: numero(n["valorServico"] ?? n["valor_servico"]),
    valorLiquido: numero(n["valorLiquido"] ?? n["valor_liquido"]),
    localEmissao: texto(n["localEmissao"] ?? n["local_emissao"]),
    emitidaEm: texto(n["emitidaEm"] ?? n["emitida_em"]),
  };
}

/** O que já foi capturado, sem falar com o Ambiente Nacional. */
export const listarNotasRecebidas = createServerFn({ method: "POST" })
  .handler(async (): Promise<ApiResult<{ notas: NotaRecebida[]; ultimoNsu: number }>> => {
    await requireAuth();
    const res = await apiFetch<unknown>(RADAR.listar);
    if (!res.ok) return res;
    const corpo = (res.data ?? {}) as Record<string, unknown>;
    const lista = extrairLista(corpo) ?? [];
    return {
      ok: true,
      data: {
        notas: lista.map(normalizarRecebida).filter((n) => n.chaveAcesso),
        ultimoNsu: Number(corpo["ultimoNsu"] ?? 0),
      },
    };
  });

/**
 * Vai ao Ambiente Nacional buscar o que chegou desde a última vez.
 *
 * O ponteiro (NSU) fica no servidor: cada busca continua de onde a anterior
 * parou, e por isso apertar duas vezes não traz nada duplicado. `desdeInicio`
 * recomeça do zero — é o que se usa quando a empresa entra na plataforma e
 * precisa do histórico, não só do que chegou hoje.
 */
export const buscarNotasNoRadar = createServerFn({ method: "POST" })
  .inputValidator((data: { lotes?: number; desdeInicio?: boolean }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ novas: number; lidas: number; ultimoNsu: number }>> => {
    await requireAuth();
    const res = await apiFetch<unknown>(RADAR.buscar, {
      method: "POST",
      // O servidor limita a 20 lotes; mandar mais não acelera, só é recusado.
      body: {
        lotes: Math.min(Math.max(Number(data.lotes) || 5, 1), 20),
        ...(data.desdeInicio ? { desdeInicio: true } : {}),
      },
    });
    if (!res.ok) return res;
    const c = (res.data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      data: {
        novas: Number(c["novas"] ?? 0),
        lidas: Number(c["lidas"] ?? c["total"] ?? 0),
        ultimoNsu: Number(c["ultimoNsu"] ?? 0),
      },
    };
  });

/**
 * O XML da nota recebida — que é o documento em si.
 *
 * Passa pelo servidor como todo download desta plataforma: um link direto
 * exporia a chave da API na barra de endereços.
 */
export const baixarXmlRecebida = createServerFn({ method: "POST" })
  .inputValidator((data: { chave: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ nome: string; tipo: string; base64: string }>> => {
    await requireAuth();
    const res = await apiFetchArquivo(RADAR.xml(data.chave));
    if (!res.ok) return res;
    return {
      ok: true,
      data: { nome: `nfse-${data.chave}.xml`, tipo: res.data.tipo || "application/xml", base64: res.data.base64 },
    };
  });

// ---------------------------------------------------------------------------
// Compras — as NF-e que a empresa RECEBEU
// ---------------------------------------------------------------------------

/**
 * A nota que o FORNECEDOR emitiu contra a empresa.
 *
 * Mesma ideia do radar de NFS-e, com duas diferenças que vêm da SEFAZ e mudam
 * o que a tela pode oferecer:
 *
 * **O resumo não é a nota.** A Distribuição DF-e entrega quase tudo como
 * `resNFe` — emitente, valor, chave — e o XML completo só é liberado depois da
 * manifestação. Por isso existe o botão de manifestar aqui, e não é enfeite: é
 * o que destrava o documento que a contabilidade precisa.
 *
 * **Insistir custa caro.** Consultar sem avançar o NSU devolve `cStat 656` e a
 * SEFAZ bloqueia o CNPJ por uma hora. O ponteiro fica no servidor justamente
 * para que apertar "buscar" duas vezes não cause isso.
 */
const COMPRAS = {
  listar: "/api/nfe/distribuicao?limit=200",
  buscar: "/api/nfe/distribuicao",
  xml: (chave: string) => `/api/nfe/distribuicao/${encodeURIComponent(chave)}/xml`,
  manifestar: "/api/manifestar",
} as const;

/**
 * Os quatro eventos de manifestação, com o que cada um DECLARA.
 *
 * Não são quatro botões equivalentes. Ciência apenas avisa que a empresa viu.
 * As outras três são declarações da empresa ao Fisco, valem como manifestação
 * formal e não têm desfazer — por isso o texto do efeito viaja junto com o
 * código, para a tela nunca oferecer uma delas sem dizer o que significa.
 */
export const EVENTOS_DE_MANIFESTACAO = [
  {
    codigo: "210210",
    nome: "Ciencia da Operacao",
    efeito: "So avisa a SEFAZ que voce viu a nota. Nao concorda nem discorda — e o que libera o XML completo.",
    grave: false,
  },
  {
    codigo: "210200",
    nome: "Confirmacao da Operacao",
    efeito: "Declara ao Fisco que a compra aconteceu e a mercadoria foi recebida. Nao tem desfazer.",
    grave: true,
  },
  {
    codigo: "210220",
    nome: "Desconhecimento da Operacao",
    efeito: "Declara que a empresa nao reconhece esta nota emitida contra ela. Acusa o emitente. Nao tem desfazer.",
    grave: true,
  },
  {
    codigo: "210240",
    nome: "Operacao nao Realizada",
    efeito: "A nota era da empresa, mas o negocio nao se concretizou (devolucao, recusa na entrega). Exige justificativa e nao tem desfazer.",
    grave: true,
  },
] as const;

export type CodigoDeManifestacao = (typeof EVENTOS_DE_MANIFESTACAO)[number]["codigo"];

export type NotaComprada = {
  chaveAcesso: string;
  nsu?: number | undefined;
  emitenteCnpj?: string | undefined;
  emitenteNome?: string | undefined;
  valorNota?: number | undefined;
  situacao?: string | undefined;
  emitidaEm?: string | undefined;
  manifestacao?: string | undefined;
  manifestadaEm?: string | undefined;
  /** Falso enquanto a nota for só resumo — o XML ainda não foi liberado. */
  temXml: boolean;
};

function normalizarComprada(bruto: unknown): NotaComprada {
  const n = (bruto ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
  const num = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));
  return {
    chaveAcesso: String(n["chaveAcesso"] ?? ""),
    nsu: num(n["nsu"]),
    emitenteCnpj: texto(n["emitenteCnpj"]),
    emitenteNome: texto(n["emitenteNome"]),
    valorNota: num(n["valorNota"]),
    situacao: texto(n["situacao"]),
    emitidaEm: texto(n["emitidaEm"]),
    manifestacao: texto(n["manifestacao"]),
    manifestadaEm: texto(n["manifestadaEm"]),
    temXml: String(n["schema"] ?? "").includes("procNFe"),
  };
}

/** O que já foi capturado, sem falar com a SEFAZ. */
export const listarCompras = createServerFn({ method: "POST" })
  .handler(async (): Promise<ApiResult<{ notas: NotaComprada[]; ultimoNsu: number; maxNsu: number }>> => {
    await requireAuth();
    const res = await apiFetch<unknown>(COMPRAS.listar);
    if (!res.ok) return res;
    const corpo = (res.data ?? {}) as Record<string, unknown>;
    const lista = extrairLista(corpo) ?? [];
    return {
      ok: true,
      data: {
        notas: lista.map(normalizarComprada).filter((n) => n.chaveAcesso),
        ultimoNsu: Number(corpo["ultimoNsu"] ?? 0),
        maxNsu: Number(corpo["maxNsu"] ?? 0),
      },
    };
  });

export const buscarCompras = createServerFn({ method: "POST" })
  .inputValidator((data: { lotes?: number; desdeInicio?: boolean }) => data)
  .handler(async ({ data }): Promise<ApiResult<{
    novas: number; lidas: number; ultimoNsu: number; maxNsu: number; emDia: boolean;
  }>> => {
    await requireAuth();
    const res = await apiFetch<unknown>(COMPRAS.buscar, {
      method: "POST",
      body: {
        lotes: Math.min(Math.max(Number(data.lotes) || 5, 1), 20),
        ...(data.desdeInicio ? { desdeInicio: true } : {}),
      },
    });
    if (!res.ok) return res;
    const c = (res.data ?? {}) as Record<string, unknown>;
    // 656 é consumo indevido: a SEFAZ bloqueia o CNPJ por uma hora. Virar erro
    // visível é melhor que um "0 novas" que convida a tentar de novo na hora.
    if (String(c["cStat"] ?? "") === "656") {
      return {
        ok: false,
        error: "A SEFAZ recusou a consulta por excesso de tentativas (consumo indevido). "
          + "Ela libera sozinha em ate uma hora — nao adianta insistir agora.",
      };
    }
    return {
      ok: true,
      data: {
        novas: Number(c["novas"] ?? 0),
        lidas: Number(c["lidas"] ?? 0),
        ultimoNsu: Number(c["ultimoNsu"] ?? 0),
        maxNsu: Number(c["maxNsu"] ?? 0),
        emDia: c["emDia"] === true,
      },
    };
  });

export const baixarXmlCompra = createServerFn({ method: "POST" })
  .inputValidator((data: { chave: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ nome: string; tipo: string; base64: string }>> => {
    await requireAuth();
    const res = await apiFetchArquivo(COMPRAS.xml(data.chave));
    if (!res.ok) return res;
    return {
      ok: true,
      data: {
        nome: `nfe-${data.chave}.xml`,
        tipo: res.data.tipo || "application/xml",
        base64: res.data.base64,
      },
    };
  });

/**
 * Manifesta a nota na SEFAZ.
 *
 * Três dos quatro eventos são declarações irreversíveis da empresa ao Fisco. A
 * confirmação de quem opera acontece na tela, com o texto do efeito à vista —
 * aqui só se garante o que a SEFAZ exige: justificativa de 15 caracteres para
 * "Operação não Realizada", que sem isso volta rejeitada depois de assinar.
 */
export const manifestarCompra = createServerFn({ method: "POST" })
  .inputValidator((data: { chave: string; evento: CodigoDeManifestacao; justificativa?: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<{
    cStat?: string | undefined; xMotivo?: string | undefined; descEvento?: string | undefined;
  }>> => {
    await requireAuth();
    if (data.evento === "210240" && (data.justificativa ?? "").trim().length < 15) {
      return { ok: false, error: "Operacao nao Realizada exige uma justificativa de pelo menos 15 caracteres." };
    }
    const res = await apiFetch<Record<string, Json>>(COMPRAS.manifestar, {
      method: "POST",
      body: {
        chaveAcesso: data.chave,
        tipoEvento: data.evento,
        ...(data.justificativa ? { justificativa: data.justificativa.trim() } : {}),
      },
    });
    if (!res.ok) return res;
    const c = res.data ?? {};
    if (c["sucesso"] !== true) {
      return { ok: false, error: String(c["xMotivo"] ?? c["erro"] ?? "A SEFAZ recusou a manifestacao.") };
    }
    return {
      ok: true,
      data: {
        cStat: c["cStat"] === undefined ? undefined : String(c["cStat"]),
        xMotivo: c["xMotivo"] === undefined ? undefined : String(c["xMotivo"]),
        descEvento: c["descEvento"] === undefined ? undefined : String(c["descEvento"]),
      },
    };
  });

// ---------------------------------------------------------------------------
// Catálogo de serviços — cadastro
// ---------------------------------------------------------------------------

/**
 * Cadastrar e apagar serviço, que faltava por inteiro.
 *
 * A plataforma só sabia LER o catálogo. Quem prestava serviço tinha duas
 * saídas, e as duas ruins: usar itens que alguém cadastrou por fora, ou marcar
 * "serviço fora do catálogo" e digitar tudo solto a cada emissão — sem NBS e
 * sem código de tributação nacional, que são justamente os campos que ninguém
 * decora e que a NFS-e exige.
 *
 * O servidor já aceitava todos os campos. Era só a tela que não existia.
 */

/** Como o ISS é tratado nesta operação. Nomes do leiaute nacional. */
export const TRIBUTACOES_ISSQN = [
  { codigo: "1", nome: "Operacao tributavel" },
  { codigo: "2", nome: "Imunidade" },
  { codigo: "3", nome: "Exportacao de servico" },
  { codigo: "4", nome: "Nao incidencia" },
] as const;

/** Quem recolhe o ISS. O padrão é o próprio prestador. */
export const RETENCOES_ISS = [
  { codigo: "1", nome: "Nao retido — quem recolhe e o prestador" },
  { codigo: "2", nome: "Retido pelo tomador" },
  { codigo: "3", nome: "Retido pelo intermediario" },
] as const;

export const salvarServicoNfse = createServerFn({ method: "POST" })
  .inputValidator((data: { servico: Record<string, string> }) => data)
  .handler(async ({ data }): Promise<ApiResult<ServicoNfse>> => {
    await requireAuth();
    const s = data.servico;
    // As três que o servidor recusa. Conferir aqui poupa uma ida à API só para
    // receber de volta o que a tela já sabia.
    if (!s["codigo"]?.trim()) return { ok: false, error: "Informe um codigo para identificar o servico." };
    if (!s["descricao"]?.trim()) return { ok: false, error: "Descreva o servico." };
    const trib = soDigitos(s["codigoTributacaoNacional"] ?? "");
    if (trib.length !== 6) {
      return {
        ok: false,
        error: "O codigo de tributacao nacional tem 6 digitos: item (2) + subitem (2) + desdobro (2). "
          + "O desdobro comeca em 01 — por exemplo, 010101.",
      };
    }
    const res = await apiFetch<{ servico?: ServicoNfse }>("/api/nfse/servicos", {
      method: "POST",
      body: { ...s, codigoTributacaoNacional: trib },
    });
    if (!res.ok) return res;
    return { ok: true, data: (res.data?.servico ?? {}) as ServicoNfse };
  });

export const removerServicoNfse = createServerFn({ method: "POST" })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<ApiResult<true>> => {
    await requireAuth();
    const res = await apiFetch<unknown>(`/api/nfse/servicos/${data.id}`, { method: "DELETE" });
    if (!res.ok) return res;
    return { ok: true, data: true };
  });
