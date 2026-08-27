/**
 * PROJETO NF-e 4.00 - MODELOS DE DOMÍNIO (TypeScript)
 * REVISÃO PROFUNDA: DecimalString para evitar falhas IEEE 754, códigos como strings,
 * Discriminated Unions corretas conforme schemas oficiais.
 */

// Tipo de alias para indicar que valores decimais/monetários virão como String
// A aplicação backend devera utilizar libs como Big.js ou Decimal.js para manipulação
export type DecimalString = string;

// ============================================================================
// ENUMS e TIPOS BÁSICOS
// ============================================================================

export enum TipoAmbiente { PRODUCAO = '1', HOMOLOGACAO = '2' }
export enum TipoEmissao { NORMAL = '1', CONTINGENCIA_FS_IA = '2', CONTINGENCIA_SCAN = '3', CONTINGENCIA_EPEC = '4', CONTINGENCIA_FS_DA = '5', CONTINGENCIA_SVC_AN = '6', CONTINGENCIA_SVC_RS = '7' }
export enum FinalidadeNFe { NORMAL = '1', COMPLEMENTAR = '2', AJUSTE = '3', DEVOLUCAO = '4' }
export enum IndicadorPresenca { NAO_SE_APLICA = '0', PRESENCIAL = '1', INTERNET = '2', TELEATENDIMENTO = '3', NFC_E_ENTREGA = '4', PRESENCIAL_FORA = '5', OUTROS = '9' }
export enum OrigemMercadoria { NACIONAL = '0', ESTRANGEIRA_IMPORTACAO_DIRETA = '1', ESTRANGEIRA_ADQUIRIDA_MERCADO_INTERNO = '2', NACIONAL_CONTEUDO_IMPORTACAO_SUPERIOR_40 = '3', NACIONAL_PRODUCAO_CONFORME_PROCESSOS_BASICO = '4', NACIONAL_CONTEUDO_IMPORTACAO_INFERIOR_40 = '5', ESTRANGEIRA_IMPORTACAO_DIRETA_SEM_SIMILAR = '6', ESTRANGEIRA_ADQUIRIDA_MERCADO_INTERNO_SEM_SIMILAR = '7', NACIONAL_CONTEUDO_IMPORTACAO_SUPERIOR_70 = '8' }

// ============================================================================
// MODELO DE DOMÍNIO E SERIALIZAÇÃO XML
// ============================================================================

export interface NFe {
    ide: IdentificacaoNFe;
    emit: Emitente;
    dest: Destinatario;
    det: DetalheItem[];
    total: TotalNFe;
    transp: Transporte;
    cobr?: Cobranca;
    pag: Pagamento;
    infAdic?: InformacoesAdicionais;
    infRespTec?: ResponsavelTecnico;
    infNFeSupl?: { qrCode: string; urlChave: string };
}

export interface IdentificacaoNFe {
    cUF: string; // Codigos IBGE devem manter string para preservacao exata
    cNF: string; // 8 digitos
    natOp: string;
    mod: string; // '55'
    serie: string;
    nNF: string;
    dhEmi: string; // ISO 8601 ex: 2024-05-10T10:00:00-03:00
    dhSaiEnt?: string;
    tpNF: string; // '0'=Entrada, '1'=Saída
    idDest: string; // '1'=Interna, '2'=Interestadual, '3'=Exterior
    cMunFG: string;
    /**
     * Chaves de NF-e referenciadas (grupo NFref). Obrigatório na devolução
     * (finNFe='4'): é o que liga o estorno à venda original. Sem isso a nota
     * diz que é devolução mas não diz de quê.
     * Posição fixa no XSD: depois de cMunFG, antes de tpImp.
     */
    NFref?: string[];
    tpImp: string; // '1'=Retrato, '2'=Paisagem
    tpEmis: TipoEmissao;
    cDV: string;
    tpAmb: TipoAmbiente;
    finNFe: FinalidadeNFe;
    indFinal: string; // '0'=Normal, '1'=Consumidor Final
    indPres: IndicadorPresenca;
    procEmi: string; // '0'=Aplicativo Contribuinte
    verProc: string; // ex: "1.0.0"
}

export interface Emitente {
    CNPJ?: string;
    CPF?: string;
    xNome: string;
    xFant?: string;
    enderEmit: Endereco;
    IE: string;
    CRT: string; // '1'=Simples, '2'=Simples Excesso, '3'=Normal
}

export interface Destinatario {
    CNPJ?: string;
    CPF?: string;
    idEstrangeiro?: string;
    xNome: string;
    enderDest: Endereco;
    indIEDest: string; // '1'=Contribuinte, '2'=Isento, '9'=Nao Contribuinte
    IE?: string;
    email?: string;
}

export interface Endereco {
    xLgr: string;
    nro: string;
    xCpl?: string;
    xBairro: string;
    cMun: string; // IBGE string
    xMun: string;
    UF: string;
    CEP: string;
    cPais: string; // '1058' (Brasil)
    xPais: string;
    fone?: string;
}

// ============================================================================
// ITENS E IMPOSTOS (Com Uniões Discriminadas Exatas e DecimalString)
// ============================================================================

export interface DetalheItem {
    nItem: string;
    prod: Produto;
    imposto: ImpostoItem;
    infAdProd?: string;
    /**
     * Documento fiscal referenciado POR ITEM. Na devolução, o NFref do cabeçalho
     * não basta: a SEFAZ exige a referência item a item (rejeição 321).
     * `nItem` aponta o item correspondente na nota original — opcional.
     * Último elemento do <det>, depois de infAdProd.
     */
    DFeReferenciado?: { chaveAcesso: string; nItem?: string };
}

export interface Produto {
    cProd: string;
    cEAN: string; 
    xProd: string;
    NCM: string;
    CEST?: string;
    /**
     * Código de Benefício Fiscal na UF. Fica em `prod`, não no grupo de ICMS —
     * é lá que o leiaute o coloca, logo depois do CEST. Estados como MG e RJ o
     * exigem quando a operação usa CST de benefício (20, 40, 51, 70).
     */
    cBenef?: string;
    CFOP: string;
    uCom: string;
    qCom: DecimalString; 
    vUnCom: DecimalString; 
    vProd: DecimalString; 
    cEANTrib: string;
    uTrib: string;
    qTrib: DecimalString; 
    vUnTrib: DecimalString; 
    vFrete?: DecimalString;
    vSeg?: DecimalString;
    vDesc?: DecimalString;
    vOutro?: DecimalString;
    indTot: string; // '0'=Nao compoe total, '1'=Compoe total
}

export interface ImpostoItem {
    vTotTrib?: DecimalString;
    ICMS?: TipoICMS;
    ICMSUFDest?: ICMSUFDest_Props;
    IPI?: TipoIPI;
    PIS?: TipoPIS;
    COFINS?: TipoCOFINS;
    IBSCBS?: ImpostoIBSCBS;
}

// ICMS: Discriminated Unions EXATAS conforme SEFAZ
export type TipoICMS =
    | { ICMS00: ICMS00_Props }
    | { ICMS02: ICMS02_Props }
    | { ICMS10: ICMS10_Props }
    | { ICMS15: ICMS15_Props }
    | { ICMS20: ICMS20_Props }
    | { ICMS30: ICMS30_Props }
    | { ICMS51: ICMS51_Props }
    | { ICMS53: ICMS53_Props }
    | { ICMS61: ICMS61_Props }
    | { ICMS90: ICMS90_Props }
    | { ICMSSN101: ICMSSN101_Props }
    | { ICMSSN202: ICMSSN202_Props }
    | { ICMSSN900: ICMSSN900_Props }
    | { ICMS40: ICMS40_Props }
    | { ICMS60: ICMS60_Props }
    | { ICMS70: ICMS70_Props }
    | { ICMSSN102: ICMSSN102_Props }
    | { ICMSSN201: ICMSSN201_Props }
    | { ICMSSN500: ICMSSN500_Props };

/**
 * Grupos de ICMS que faltavam.
 *
 * Ate agora o motor recusava estes CST/CSOSN nomeando o codigo — comportamento
 * correto (melhor que inventar), mas parada seca para quem precisa deles. O
 * ICMSSN101 e o que mais pesa comercialmente: e por ele que a empresa do Simples
 * TRANSFERE credito de ICMS ao comprador, o que e argumento de venda para quem
 * atende empresa de regime normal.
 *
 * A ordem dos campos segue o XSD. Trocar rende rejeicao de schema (cStat 225),
 * que nao diz qual campo errou.
 */

/** CST 30 — isenta ou nao tributada COM ST cobrada anteriormente. */
export interface ICMS30_Props {
    orig: OrigemMercadoria;
    CST: '30';
    modBCST: string;
    pMVAST?: DecimalString;
    pRedBCST?: DecimalString;
    vBCST: DecimalString;
    pICMSST: DecimalString;
    vICMSST: DecimalString;
    vICMSDeson?: DecimalString;
    motDesICMS?: string;
}

/** CST 51 — diferimento. O que nao se paga agora vai em vICMSDif. */
export interface ICMS51_Props {
    orig: OrigemMercadoria;
    CST: '51';
    modBC?: string;
    pRedBC?: DecimalString;
    vBC?: DecimalString;
    pICMS?: DecimalString;
    vICMSOp?: DecimalString;
    pDif?: DecimalString;
    vICMSDif?: DecimalString;
    vICMS?: DecimalString;
}

/** CST 90 — outras. O curinga do leiaute. */
export interface ICMS90_Props {
    orig: OrigemMercadoria;
    CST: '90';
    modBC?: string;
    vBC?: DecimalString;
    pRedBC?: DecimalString;
    pICMS?: DecimalString;
    vICMS?: DecimalString;
    modBCST?: string;
    pMVAST?: DecimalString;
    pRedBCST?: DecimalString;
    vBCST?: DecimalString;
    pICMSST?: DecimalString;
    vICMSST?: DecimalString;
}

/** CSOSN 101 — Simples COM permissao de credito. */
export interface ICMSSN101_Props {
    orig: OrigemMercadoria;
    CSOSN: '101';
    pCredSN: DecimalString;
    vCredICMSSN: DecimalString;
}

/** CSOSN 202 — Simples sem credito, com ST. */
export interface ICMSSN202_Props {
    orig: OrigemMercadoria;
    CSOSN: '202';
    modBCST: string;
    pMVAST?: DecimalString;
    pRedBCST?: DecimalString;
    vBCST: DecimalString;
    pICMSST: DecimalString;
    vICMSST: DecimalString;
}

/** CSOSN 900 — Simples, outras. */
export interface ICMSSN900_Props {
    orig: OrigemMercadoria;
    CSOSN: '900';
    modBC?: string;
    vBC?: DecimalString;
    pRedBC?: DecimalString;
    pICMS?: DecimalString;
    vICMS?: DecimalString;
    modBCST?: string;
    pMVAST?: DecimalString;
    pRedBCST?: DecimalString;
    vBCST?: DecimalString;
    pICMSST?: DecimalString;
    vICMSST?: DecimalString;
    pCredSN?: DecimalString;
    vCredICMSSN?: DecimalString;
}

/**
 * Monofasicos de combustivel (CST 02, 15, 53, 61).
 *
 * Tributacao AD REM: o imposto sai da QUANTIDADE vezes um valor por unidade
 * (`adRemICMS`), nao de uma aliquota sobre o valor. Por isso estes grupos nao
 * tem `pICMS` nem `vBC` — e por isso o motor nao os calcula: quem informa a
 * quantidade tributavel e o valor por unidade e quem emite, a partir da tabela
 * do combustivel. Aqui eles sao montados fielmente, nao deduzidos.
 */
export interface ICMS02_Props {
    orig: OrigemMercadoria;
    CST: '02';
    qBCMono?: DecimalString;
    adRemICMS: DecimalString;
    vICMSMono: DecimalString;
}

export interface ICMS15_Props {
    orig: OrigemMercadoria;
    CST: '15';
    qBCMono?: DecimalString;
    adRemICMS: DecimalString;
    vICMSMono: DecimalString;
    qBCMonoReten?: DecimalString;
    adRemICMSReten: DecimalString;
    vICMSMonoReten: DecimalString;
    pRedAdRem?: DecimalString;
    motRedAdRem?: string;
}

export interface ICMS53_Props {
    orig: OrigemMercadoria;
    CST: '53';
    qBCMono?: DecimalString;
    adRemICMS?: DecimalString;
    vICMSMonoOp?: DecimalString;
    pDif?: DecimalString;
    vICMSMonoDif?: DecimalString;
    vICMSMono?: DecimalString;
}

export interface ICMS61_Props {
    orig: OrigemMercadoria;
    CST: '61';
    qBCMonoRet?: DecimalString;
    adRemICMSRet: DecimalString;
    vICMSMonoRet: DecimalString;
}

export interface ICMS00_Props {
    orig: OrigemMercadoria;
    CST: '00';
    modBC: string;
    vBC: DecimalString;
    pICMS: DecimalString;
    vICMS: DecimalString;
    pFCP?: DecimalString;
    vFCP?: DecimalString;
}

export interface ICMS20_Props {
    orig: OrigemMercadoria;
    CST: '20';
    modBC: string;
    pRedBC: DecimalString;
    vBC: DecimalString;
    pICMS: DecimalString;
    vICMS: DecimalString;
    vICMSDeson?: DecimalString;
    motDesICMS?: string;
}

export interface ICMS40_Props {
    orig: OrigemMercadoria;
    CST: '40' | '41' | '50';
    vICMSDeson?: DecimalString;
    motDesICMS?: string;
}

export interface ICMS10_Props {
    orig: OrigemMercadoria;
    CST: '10';
    modBC: string;
    vBC: DecimalString;
    pICMS: DecimalString;
    vICMS: DecimalString;
    modBCST: string;
    pMVAST?: DecimalString;
    pRedBCST?: DecimalString;
    vBCST: DecimalString;
    pICMSST: DecimalString;
    vICMSST: DecimalString;
}

export interface ICMS60_Props {
    orig: OrigemMercadoria;
    CST: '60';
    vBCSTRet?: DecimalString;
    vICMSSTRet?: DecimalString;
    vICMSSubstituto?: DecimalString;
}

export interface ICMS70_Props {
    orig: OrigemMercadoria;
    CST: '70';
    modBC: string;
    pRedBC: DecimalString;
    vBC: DecimalString;
    pICMS: DecimalString;
    vICMS: DecimalString;
    modBCST: string;
    pMVAST?: DecimalString;
    pRedBCST?: DecimalString;
    vBCST: DecimalString;
    pICMSST: DecimalString;
    vICMSST: DecimalString;
    vICMSDeson?: DecimalString;
    motDesICMS?: string;
}

export interface ICMSSN102_Props {
    orig: OrigemMercadoria;
    CSOSN: '102' | '103' | '300' | '400';
}

export interface ICMSSN201_Props {
    orig: OrigemMercadoria;
    CSOSN: '201';
    modBCST: string;
    pMVAST?: DecimalString;
    pRedBCST?: DecimalString;
    vBCST: DecimalString;
    pICMSST: DecimalString;
    vICMSST: DecimalString;
    pCredSN?: DecimalString;
    vCredICMSSN?: DecimalString;
}

export interface ICMSSN500_Props {
    orig: OrigemMercadoria;
    CSOSN: '500';
    vBCSTRet?: DecimalString;
    vICMSSTRet?: DecimalString;
}

export interface ICMSUFDest_Props {
    vBCUFDest: DecimalString;
    vBCFCPUFDest?: DecimalString;
    pFCPUFDest?: DecimalString;
    pICMSUFDest: DecimalString;
    pICMSInter: DecimalString;
    pICMSInterPart: DecimalString;
    vFCPUFDest?: DecimalString;
    vICMSUFDest: DecimalString;
    vICMSUFRemet: DecimalString;
}

export type TipoIPI = { IPITrib: IPITrib_Props } | { IPINT: IPINT_Props };

export interface IPITrib_Props { CST: '50' | '49' | '99'; cEnq: string; vBC?: DecimalString; pIPI?: DecimalString; vIPI?: DecimalString; }
export interface IPINT_Props { CST: '51' | '52' | '53' | '54' | '55'; cEnq: string; }

// Cada CST pertence a um grupo diferente no XSD, e o grupo errado é rejeitado:
//   PISAliq  CST 01, 02        — tributado por alíquota
//   PISNT    CST 04 a 08       — não tributado, só o CST
//   PISOutr  CST 49 a 99       — demais operações
export type TipoPIS = { PISAliq: PISAliq_Props } | { PISNT: PISNT_Props } | { PISOutr: PISOutr_Props };
export interface PISAliq_Props { CST: '01' | '02'; vBC: DecimalString; pPIS: DecimalString; vPIS: DecimalString; }
export interface PISNT_Props { CST: '04' | '05' | '06' | '07' | '08'; }
export interface PISOutr_Props { CST: string; vBC?: DecimalString; pPIS?: DecimalString; vPIS?: DecimalString; }

export type TipoCOFINS = { COFINSAliq: COFINSAliq_Props } | { COFINSNT: COFINSNT_Props } | { COFINSOutr: COFINSOutr_Props };
export interface COFINSAliq_Props { CST: '01' | '02'; vBC: DecimalString; pCOFINS: DecimalString; vCOFINS: DecimalString; }
export interface COFINSNT_Props { CST: '04' | '05' | '06' | '07' | '08'; }
export interface COFINSOutr_Props { CST: string; vBC?: DecimalString; pCOFINS?: DecimalString; vCOFINS?: DecimalString; }

/**
 * Grupo TRed do XSD — redução de alíquota do cClassTrib.
 *
 * É assim que "alíquota zero" se escreve na Reforma: não existe CST de alíquota
 * zero na tabela oficial. O que existe é o CST 200 (alíquota reduzida) com este
 * grupo dizendo o quanto reduz. Fruta fresca, por exemplo, é redução de 100% —
 * pRedAliq 100,0000 e pAliqEfet 0,0000, resultando em valor zero.
 *
 * Sem este grupo o motor destacava a alíquota cheia mesmo em item com CST 200:
 * um item que declarava redução e cobrava tributo na mesma linha.
 */
export interface RedIbsCbs {
    /** Percentual de redução de alíquota do cClassTrib (100 = alíquota zero). */
    pRedAliq: DecimalString;
    /** Alíquota que sobra e incide sobre a base, já com a redução aplicada. */
    pAliqEfet: DecimalString;
}

// Regras exatas NT 2024.001 IBS/CBS
export interface ImpostoIBSCBS {
    CST: string; // Ex: '000'
    cClassTrib: string; // Ex: '000001'
    gIBSCBS: {
        vBC: DecimalString;
        // A ordem dos campos segue o XSD (TCIBS): a alíquota, o gRed opcional e
        // só então o valor. Trocar rende rejeição de schema.
        gIBSUF: { pIBSUF: DecimalString; gRed?: RedIbsCbs; vIBSUF: DecimalString; };
        gIBSMun: { pIBSMun: DecimalString; gRed?: RedIbsCbs; vIBSMun: DecimalString; };
        vIBS: DecimalString;
        gCBS: { pCBS: DecimalString; gRed?: RedIbsCbs; vCBS: DecimalString; };
    }
}

// ============================================================================
// TOTAIS, COBRANÇA, TRANSPORTE, PAGAMENTO
// ============================================================================

export interface TotalNFe {
    ICMSTot: {
        vBC: DecimalString; vICMS: DecimalString; vICMSDeson: DecimalString;
        vFCPUFDest?: DecimalString; vICMSUFDest?: DecimalString; vICMSUFRemet?: DecimalString;
        vFCP: DecimalString; vBCST: DecimalString; vST: DecimalString;
        vFCPST: DecimalString; vFCPSTRet: DecimalString;
        vProd: DecimalString; vFrete: DecimalString; vSeg: DecimalString; vDesc: DecimalString;
        vII: DecimalString; vIPI: DecimalString; vIPIDevol: DecimalString;
        vPIS: DecimalString; vCOFINS: DecimalString;
        vOutro: DecimalString; vNF: DecimalString;
        /**
         * Valor aproximado dos tributos (Lei 12.741/2012).
         *
         * O DANFE tem um quadro "V. TOT. TRIB." que lê daqui. Sem o campo, ele
         * sai impresso como R$ 0,00.
         */
        vTotTrib?: DecimalString;
    };
    IBSCBSTot?: {
        vBCIBSCBS: DecimalString;
        gIBS: {
            gIBSUF: { vDif: DecimalString; vDevTrib: DecimalString; vIBSUF: DecimalString; };
            gIBSMun: { vDif: DecimalString; vDevTrib: DecimalString; vIBSMun: DecimalString; };
            vIBS: DecimalString;
            vCredPres: DecimalString; vCredPresCondSus: DecimalString;
        };
        gCBS: {
            vDif: DecimalString; vDevTrib: DecimalString; vCBS: DecimalString;
            vCredPres: DecimalString; vCredPresCondSus: DecimalString;
        };
    };
}

export interface Cobranca {
    fat?: { nFat: string; vOrig: DecimalString; vDesc: DecimalString; vLiq: DecimalString; };
    dup?: { nDup: string; dVenc: string; vDup: DecimalString; }[];
}

export interface Transporte {
    modFrete: string; 
    transporta?: { CNPJ?: string; CPF?: string; xNome: string; IE?: string; xEnder: string; xMun: string; UF: string; };
    veicTransp?: { placa: string; UF: string; RNTRC?: string; };
    vol?: { qVol?: string; esp?: string; marca?: string; nVol?: string; pesoL?: DecimalString; pesoB?: DecimalString; }[];
}

export interface Pagamento {
    detPag: {
        indPag?: string; 
        tPag: string; 
        vPag: DecimalString;
        tpIntegra?: string; 
        CNPJ?: string;
        tBand?: string;
        cAut?: string;
    }[];
    vTroco?: DecimalString;
}

export interface InformacoesAdicionais {
    infAdFisco?: string;
    infCpl?: string;
}

export interface ResponsavelTecnico {
    CNPJ: string;
    xContato: string;
    email: string;
    fone: string;
    idCSRT?: string;
    hashCSRT?: string;
}
