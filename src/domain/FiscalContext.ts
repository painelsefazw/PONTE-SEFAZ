/**
 * NF-e 4.00 — FiscalContext: builder that constructs a valid NFe from simplified input.
 * All arithmetic uses Decimal.js exclusively.
 */

import Decimal from 'decimal.js';
import { somenteDigitos, erroDeDocumento } from './Documento';
import type {
  NFe,
  IdentificacaoNFe,
  Emitente,
  Destinatario,
  DetalheItem,
  Produto,
  ImpostoItem,
  TotalNFe,
  Transporte,
  Pagamento,
  InformacoesAdicionais,
  Endereco,
  TipoICMS,
  TipoIPI,
  ICMSUFDest_Props,
  TipoPIS,
  TipoCOFINS,
  PISNT_Props,
  COFINSNT_Props,
  ImpostoIBSCBS,
  DecimalString,
} from './models';
import { TipoEmissao, TipoAmbiente, FinalidadeNFe, IndicadorPresenca, OrigemMercadoria } from './models';

// ---------------------------------------------------------------------------
// UF → IBGE code map (all 27 Brazilian states)
// ---------------------------------------------------------------------------
export const UF_TO_IBGE: Record<string, string> = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23', DF: '53',
  ES: '32', GO: '52', MA: '21', MT: '51', MS: '50', MG: '31', PA: '15',
  PB: '25', PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24', RS: '43',
  RO: '11', RR: '14', SC: '42', SP: '35', SE: '28', TO: '17',
};

// ---------------------------------------------------------------------------
// Input interfaces
// ---------------------------------------------------------------------------

export interface FiscalContextEndereco {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  codigoMunicipio: string;
  nomeMunicipio: string;
  uf: string;
  cep: string;
  fone?: string;
}

export interface FiscalContextEmitente {
  cnpj: string;
  razaoSocial: string;
  fantasia?: string;
  ie: string;
  crt: string;
  endereco: FiscalContextEndereco;
}

export interface FiscalContextDestinatario {
  cnpj?: string;
  cpf?: string;
  razaoSocial: string;
  indIEDest: string;
  ie?: string;
  email?: string;
  endereco: FiscalContextEndereco;
}

export interface FiscalContextICMS {
  origem: string;
  cst?: string;
  csosn?: string;
  modBC?: string;
  vBC?: string;
  pICMS?: string;
  vICMS?: string;
  pRedBC?: string;
  vICMSDeson?: string;
  motDesICMS?: string;
  // ICMS-ST fields (CST 10, 70, CSOSN 201)
  modBCST?: string;
  pMVAST?: string;
  pRedBCST?: string;
  vBCST?: string;
  pICMSST?: string;
  vICMSST?: string;
  // ICMS-ST retido (CST 60, CSOSN 500)
  vBCSTRet?: string;
  vICMSSTRet?: string;
  // Simples Nacional crédito (CSOSN 201)
  pCredSN?: string;
  vCredICMSSN?: string;
  /**
   * Aceito aqui só porque é onde o painel e a classificação o colocam. O leiaute
   * põe o cBenef em `prod`, e é para lá que ele é levado na montagem.
   */
  cBenef?: string;

  // Diferimento (CST 51 e 90): o quanto do imposto fica para depois.
  pDif?: string;
  vICMSDif?: string;
  vICMSOp?: string;

  /**
   * Monofásico de combustível (CST 02, 15, 53, 61).
   *
   * Tributação AD REM: o imposto sai da QUANTIDADE vezes um valor por unidade,
   * não de uma alíquota sobre o valor. O motor não calcula estes — quem emite
   * informa, a partir da tabela do combustível. Deduzir aqui seria inventar
   * tributo num regime que nem usa base de cálculo.
   */
  qBCMono?: string;
  adRemICMS?: string;
  vICMSMono?: string;
  qBCMonoReten?: string;
  adRemICMSReten?: string;
  vICMSMonoReten?: string;
  pRedAdRem?: string;
  motRedAdRem?: string;
  vICMSMonoOp?: string;
  vICMSMonoDif?: string;
  qBCMonoRet?: string;
  adRemICMSRet?: string;
  vICMSMonoRet?: string;
}

export interface FiscalContextIPI {
  cst: string;
  cEnq?: string;
  vBC?: string;
  pIPI?: string;
  vIPI?: string;
}

export interface FiscalContextPIS {
  cst: string;
  aliquota?: string;
}

export interface FiscalContextCOFINS {
  cst: string;
  aliquota?: string;
}

export interface FiscalContextItem {
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: string;
  valorUnitario: string;
  ean?: string;
  cest?: string;
  /** Código de Benefício Fiscal na UF (MG, RJ e outros exigem com CST 20/40/51/70). */
  cBenef?: string;
  /**
   * Alíquota interna da UF de DESTINO para este produto, usada no DIFAL.
   *
   * É por item porque a alíquota interna é do produto no estado de destino, não
   * do estado em abstrato: no mesmo destino, cesta básica e bebida têm alíquotas
   * diferentes. Uma alíquota única para a nota inteira só acerta por acidente.
   */
  pICMSUFDest?: string;
  /** Fundo de Combate à Pobreza da UF de destino, quando o produto está sujeito. */
  pFCPUFDest?: string;
  /**
   * Acessórios do item. O leiaute os tem em `prod` e o totalizador precisa
   * fechar com a soma dos itens, então valor informado no cabeçalho é rateado
   * proporcionalmente antes de chegar aqui.
   */
  desconto?: string;
  frete?: string;
  seguro?: string;
  despesas?: string;
  icms: FiscalContextICMS;
  ipi?: FiscalContextIPI;
  pis: FiscalContextPIS;
  cofins: FiscalContextCOFINS;
  /**
   * IBS/CBS do item (Reforma Tributaria). Omitido usa tributacao integral com as
   * aliquotas de transicao de 2026. Informe para operacoes com tratamento proprio.
   */
  ibscbs?: {
    cst?: string;
    cClassTrib?: string;
    vBC?: string;
    pIBSUF?: string;
    pIBSMun?: string;
    pCBS?: string;
    /**
     * Percentual de reducao de aliquota, so para CST 200. "100" = aliquota zero.
     * Dispensavel quando o cClassTrib ja consta da tabela embutida.
     */
    pRedAliq?: string;
  };
  /**
   * Chave da nota de origem deste item. Só é preciso informar quando a devolução
   * mistura itens de notas diferentes — com uma única nota referenciada, o
   * motor replica automaticamente em todos os itens.
   */
  notaReferenciada?: string;
  /** Número do item na nota original (opcional). */
  itemReferenciado?: string;
}

export interface FiscalContextPagamento {
  formas: Array<{ tipo: string; valor: string }>;
  troco?: string;
}

export interface FiscalContextInput {
  emitente: FiscalContextEmitente;
  destinatario: FiscalContextDestinatario;
  itens: FiscalContextItem[];
  pagamento: FiscalContextPagamento;
  naturezaOperacao: string;
  serie: string;
  numero: string;
  dataEmissao: string; // ISO 8601
  finalidade: string;
  /**
   * Chaves de NF-e referenciadas. Obrigatório na devolução (finalidade '4') e
   * na complementar ('2'). Aceita uma chave ou várias.
   */
  notasReferenciadas?: string | string[];
  tipoOperacao: string; // '0' or '1'
  destino: string;      // '1','2','3'
  indFinal?: string;    // '0' normal, '1' consumidor final (default '1')
  presenca: string;
  ambiente: string;     // '1' or '2'
  municipioFG: string;
  ufEmitente: string;   // 2-letter state code
  modFrete?: string;
  informacoesAdicionais?: { fisco?: string; complementar?: string };
  pICMSUFDest?: string; // alíquota interna UF destino para DIFAL (default '18')
  pFCPUFDest?: string;  // Fundo de Combate à Pobreza da UF de destino
  mod?: '55' | '65'; // '55'=NF-e, '65'=NFC-e (default '55')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Valor no formato brasileiro, para texto lido por pessoa. */
function formatarReal(v: Decimal): string {
  const [inteira, centavos] = v.toFixed(2).split('.');
  return `${inteira.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${centavos}`;
}

/**
 * Aliquota efetiva " (0,10%)" a partir dos valores apurados.
 *
 * Derivada do resultado, e nao das constantes de 2026, porque o item pode
 * trazer aliquota propria — o texto impresso tem que bater com o XML.
 */
function aliquotaEfetiva(valor: Decimal, base: Decimal): string {
  if (base.isZero()) return '';
  const pct = valor.div(base).mul(100).toDecimalPlaces(4);
  return ` (${pct.toFixed(2).replace('.', ',')}%)`;
}

/** Acessório do item: só vai ao XML quando tem valor. */
function acessorioOuUndefined(valor: string | undefined): string | undefined {
  if (valor === undefined || valor === null || String(valor).trim() === '') return undefined;
  const d = new Decimal(String(valor).replace(',', '.'));
  return d.isZero() ? undefined : d.toFixed(2);
}

function toEndereco(e: FiscalContextEndereco): Endereco {
  return {
    xLgr: limitarTexto(e.logradouro, 'xLgr')!,
    // `nro` é obrigatório. Vazio faz o elemento sumir do XML, e o schema
    // rejeita com cStat 225 apontando o campo seguinte ("xBairro não é
    // esperado, esperado nro") — que não ajuda quem lê.
    //
    // "S/N" é o valor convencional para endereço sem número e é o que a
    // própria tela sugere como padrão. Preencher aqui garante que a nota saia
    // pelo mesmo caminho vindo da API, onde ninguém aplica esse padrão.
    nro: String(e.numero ?? '').trim() || 'S/N',
    xCpl: limitarTexto(e.complemento, 'xCpl'),
    xBairro: limitarTexto(e.bairro, 'xBairro')!,
    cMun: e.codigoMunicipio,
    xMun: limitarTexto(e.nomeMunicipio, 'xMun')!,
    UF: e.uf,
    // CEP e fone com formatação são CORRIGIDOS, não recusados: o leiaute exige
    // `[0-9]{8}` e `[0-9]{6,14}`, e "08710-100" ou "(11) 98888-7777" derrubavam
    // a nota por schema. A tela já fazia esse `replace` desde sempre — quem
    // entra pela API é que não tinha a rede.
    CEP: somenteDigitos(e.cep),
    cPais: '1058',
    xPais: 'Brasil',
    fone: somenteDigitos(e.fone) || undefined,
  };
}

/**
 * Primeiros dígitos do CEP por UF.
 *
 * Faixa fixa e pequena, e pega o erro que nenhuma outra conferência pega: CEP
 * copiado do cadastro de outro cliente. "01310-100" (São Paulo) num endereço de
 * MG passa por todas as validações de formato — e a SEFAZ recusa.
 */
const FAIXA_CEP_DA_UF: Record<string, [number, number]> = {
  SP: [1000000, 19999999], RJ: [20000000, 28999999], ES: [29000000, 29999999],
  MG: [30000000, 39999999], BA: [40000000, 48999999], SE: [49000000, 49999999],
  PE: [50000000, 56999999], AL: [57000000, 57999999], PB: [58000000, 58999999],
  RN: [59000000, 59999999], CE: [60000000, 63999999], PI: [64000000, 64999999],
  MA: [65000000, 65999999], PA: [66000000, 68899999], AP: [68900000, 68999999],
  AM: [69000000, 69299999], RR: [69300000, 69399999], AM_2: [69400000, 69899999],
  AC: [69900000, 69999999], DF: [70000000, 73699999], GO: [72800000, 76799999],
  TO: [77000000, 77999999], MT: [78000000, 78899999], RO: [76800000, 76999999],
  MS: [79000000, 79999999], PR: [80000000, 87999999], SC: [88000000, 89999999],
  RS: [90000000, 99999999],
};

/**
 * Confere o CEP contra a UF, e devolve o motivo da recusa.
 *
 * Amazonas tem duas faixas, e por isso a tabela acima carrega `AM_2`: uma UF com
 * faixa partida que só coubesse numa entrada faria metade do estado ser
 * recusada.
 */
export function erroDeCep(cep: string | undefined, uf: string | undefined): string | undefined {
  const digitos = somenteDigitos(cep);
  const sigla = String(uf ?? '').trim().toUpperCase();
  if (!digitos || !sigla || sigla === 'EX') return undefined;

  if (digitos.length !== 8) {
    return `CEP_INVALIDO: o CEP "${cep}" tem ${digitos.length} dígito(s) — o leiaute exige 8.`;
  }

  const faixas = Object.entries(FAIXA_CEP_DA_UF)
    .filter(([chave]) => chave.split('_')[0] === sigla)
    .map(([, faixa]) => faixa);
  if (!faixas.length) return undefined;

  const n = Number(digitos);
  if (!faixas.some(([de, ate]) => n >= de && n <= ate)) {
    const legivel = faixas.map(([de, ate]) =>
      `${String(de).padStart(8, '0')}-${String(ate).padStart(8, '0')}`).join(' ou ');
    return `CEP_FORA_DA_UF: o CEP ${digitos} não pertence a ${sigla} (faixa ${legivel}). `
      + 'É o erro de cadastro copiado de outro cliente — nenhuma conferência de formato pega.';
  }
  return undefined;
}

function generateCNF(): string {
  // Random 8-digit code (used in chave de acesso)
  return String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0');
}

/**
 * Deriva base e valor do ICMS próprio quando só a alíquota foi informada.
 *
 * **Só preenche o que veio vazio.** Quem manda `vBC` e `vICMS` explícitos — o
 * painel do Emissor manda — continua mandando, e a nota sai byte a byte igual.
 *
 * Sem isto, `aliqIcms: "18"` no formato plano da API produzia `pICMS` 18% com
 * `vBC` e `vICMS` zerados: uma nota que a SEFAZ aceita e que está fiscalmente
 * errada, com a alíquota declarada e o imposto ausente. É o formato que as
 * plataformas geradas usam, então toda empresa de regime normal atendida por uma
 * delas emitiria sem ICMS destacado — e a tela mostraria o valor certo.
 *
 * `modBC` 3 é "valor da operação": produtos menos desconto, mais frete, seguro e
 * despesas acessórias. A redução de base (`pRedBC`) entra antes da alíquota.
 */
function calcularIcmsProprio(
  icms: FiscalContextICMS,
  base: Decimal,
): { vBC: string; vICMS: string } {
  const pICMS = new Decimal(icms.pICMS ?? '0');

  // Sem alíquota declarada não se deriva base. Parece conservador demais, e é de
  // propósito: preencher o vBC de uma nota que não diz quanto tributa faz o
  // DIFAL nascer sozinho — a partilha interestadual sai do vBC — e apareceria
  // imposto onde ninguém pediu. Derivar só quando há alíquota mantém a mudança
  // restrita a exatamente o caso defeituoso: alíquota informada, imposto zerado.
  if (icms.vBC == null && pICMS.lte(0)) {
    return { vBC: icms.vBC ?? '0.00', vICMS: icms.vICMS ?? '0.00' };
  }

  const pRed = new Decimal(icms.pRedBC ?? '0');
  const vBC = icms.vBC != null
    ? new Decimal(icms.vBC)
    : base.mul(new Decimal('100').minus(pRed)).div(100);
  const vICMS = icms.vICMS != null
    ? new Decimal(icms.vICMS)
    : vBC.mul(pICMS).div(100);
  return { vBC: vBC.toFixed(2), vICMS: vICMS.toFixed(2) };
}

/**
 * Substituição tributária pela margem de valor agregado (`modBCST` 4).
 *
 * A base da ST é a da operação somada ao IPI e majorada pela MVA; o valor devido
 * é o ICMS da base cheia menos o próprio ICMS da operação, que já foi recolhido.
 * Mesma conta que o painel faz na tela — o objetivo é que os dois caminhos
 * cheguem ao mesmo número, e não que cada um tenha o seu.
 */
function calcularIcmsSt(
  icms: FiscalContextICMS,
  base: Decimal,
  vIPI: Decimal,
  vICMSProprio: string,
): { vBCST: string; vICMSST: string } {
  const mva = new Decimal(icms.pMVAST ?? '0');
  const pRedST = new Decimal(icms.pRedBCST ?? '0');
  const vBCST = icms.vBCST != null
    ? new Decimal(icms.vBCST)
    : base.plus(vIPI)
      .mul(new Decimal('100').plus(mva)).div(100)
      .mul(new Decimal('100').minus(pRedST)).div(100);
  const bruto = vBCST.mul(new Decimal(icms.pICMSST ?? '0')).div(100);
  const vICMSST = icms.vICMSST != null
    ? new Decimal(icms.vICMSST)
    // Nunca negativo: ICMS próprio maior que o da base cheia significa que não
    // há nada a recolher por substituição, não que a SEFAZ deva ao contribuinte.
    : Decimal.max(0, bruto.minus(new Decimal(vICMSProprio)));
  return { vBCST: vBCST.toFixed(2), vICMSST: vICMSST.toFixed(2) };
}

/**
 * Campo de monofasico que o motor nao tem como deduzir.
 *
 * Recusa nomeando o campo em vez de mandar zero: zero num grupo ad rem afirma
 * que nao ha imposto, e a nota sai AUTORIZADA errada — o pior desfecho.
 */
function exigirMonofasico(icms: FiscalContextICMS, campos: string[], cst: string): void {
  const faltando = campos.filter(c => !(icms as unknown as Record<string, unknown>)[c]);
  if (faltando.length) {
    throw new ErroDeDados(
      `ICMS CST ${cst} (monofasico de combustivel) exige ${faltando.join(', ')}. ` +
      `Sao valores AD REM, por unidade, vindos da tabela do combustivel — ` +
      `o emissor nao os calcula.`,
    );
  }
}

function buildICMS(icms: FiscalContextICMS, base: Decimal, vIPI: Decimal): TipoICMS {
  const orig = icms.origem as OrigemMercadoria;

  if (icms.csosn) {
    switch (icms.csosn) {
      case '201': {
        // No Simples não há ICMS próprio destacado, então nada é abatido do
        // valor da substituição — o `0.00` no lugar do ICMS da operação é a
        // diferença real em relação ao CST 10 do regime normal.
        const st = calcularIcmsSt(icms, base, vIPI, '0.00');
        // `pCredSN` e `vCredICMSSN` são OBRIGATÓRIOS no ICMSSN201 pelo leiaute.
        // Como nada os preenchia, nenhuma empresa do Simples conseguia emitir
        // nota com substituição tributária: o schema reprovava antes da SEFAZ,
        // e a rejeição vinha como cStat 225, que não diz o campo.
        //
        // O default é zero — nenhum crédito transferido. É o valor conservador:
        // o emitente não deve nada por transferir menos crédito do que poderia;
        // quem deixa de aproveitar é o comprador. Informe `pCredSN` com a
        // alíquota da faixa do Simples para transferir o crédito de verdade.
        const pCredSN = icms.pCredSN ?? '0.00';
        return {
          ICMSSN201: {
            orig,
            CSOSN: '201',
            modBCST: icms.modBCST ?? '4',
            pMVAST: icms.pMVAST,
            pRedBCST: icms.pRedBCST,
            vBCST: st.vBCST,
            pICMSST: icms.pICMSST ?? '0.00',
            vICMSST: st.vICMSST,
            pCredSN,
            vCredICMSSN: icms.vCredICMSSN
              ?? base.mul(new Decimal(pCredSN)).div(100).toFixed(2),
          },
        };
      }
      case '500':
        return {
          ICMSSN500: {
            orig,
            CSOSN: '500',
            vBCSTRet: icms.vBCSTRet,
            vICMSSTRet: icms.vICMSSTRet,
          },
        };
      case '101': {
        // O CSOSN que transfere credito ao comprador. E o argumento de venda de
        // quem e do Simples e atende empresa de regime normal: sem ele, o
        // comprador nao aproveita nada e prefere o concorrente do regime normal.
        const pCredSN = icms.pCredSN ?? '0.00';
        return {
          ICMSSN101: {
            orig,
            CSOSN: '101',
            pCredSN,
            vCredICMSSN: icms.vCredICMSSN
              ?? base.mul(new Decimal(pCredSN)).div(100).toFixed(2),
          },
        };
      }
      case '202': {
        // Igual ao 201, sem o credito. A base da ST inclui o IPI.
        const st = calcularIcmsSt(icms, base, vIPI, '0.00');
        return {
          ICMSSN202: {
            orig,
            CSOSN: '202',
            modBCST: icms.modBCST ?? '4',
            pMVAST: icms.pMVAST,
            pRedBCST: icms.pRedBCST,
            vBCST: st.vBCST,
            pICMSST: icms.pICMSST ?? '0.00',
            vICMSST: st.vICMSST,
          },
        };
      }
      case '900': {
        // "Outras": o curinga do Simples. Aceita proprio, ST e credito, todos
        // opcionais — por isso so vai o que foi informado, em vez de zeros que
        // afirmariam tributacao que ninguem pediu.
        const p = calcularIcmsProprio(icms, base);
        const temProprio = icms.pICMS != null || icms.vBC != null;
        const temSt = icms.vBCST != null || icms.pICMSST != null || icms.pMVAST != null;
        const st = temSt ? calcularIcmsSt(icms, base, vIPI, '0.00') : undefined;
        return {
          ICMSSN900: {
            orig,
            CSOSN: '900',
            ...(temProprio ? {
              modBC: icms.modBC ?? '3',
              vBC: p.vBC,
              pRedBC: icms.pRedBC,
              pICMS: icms.pICMS ?? '0.00',
              vICMS: p.vICMS,
            } : {}),
            ...(st ? {
              modBCST: icms.modBCST ?? '4',
              pMVAST: icms.pMVAST,
              pRedBCST: icms.pRedBCST,
              vBCST: st.vBCST,
              pICMSST: icms.pICMSST ?? '0.00',
              vICMSST: st.vICMSST,
            } : {}),
            ...(icms.pCredSN ? {
              pCredSN: icms.pCredSN,
              vCredICMSSN: icms.vCredICMSSN
                ?? base.mul(new Decimal(icms.pCredSN)).div(100).toFixed(2),
            } : {}),
          },
        };
      }
      // ICMSSN102 abriga 102, 103, 300 e 400 — sao os quatro CSOSN sem valor a
      // destacar, e o XSD so aceita esses quatro dentro do grupo.
      case '102': case '103': case '300': case '400':
        return {
          ICMSSN102: {
            orig,
            CSOSN: icms.csosn as '102' | '103' | '300' | '400',
          },
        };
      default:
        // O default caia aqui e forcava QUALQUER CSOSN desconhecido para dentro
        // do ICMSSN102. CSOSN 900 saia como <ICMSSN102><CSOSN>900</CSOSN>, que o
        // XSD reprova falando de "CSOSN" — campo que o operador nunca digitou, e
        // por isso um diagnostico impossivel. Recusar nomeando o codigo troca
        // uma rejeicao ilegivel por uma frase que diz o que fazer.
        throw new ErroDeDados(
          `ICMS: CSOSN ${icms.csosn} ainda nao e suportado por este emissor. ` +
          `Suportados hoje: 101, 102, 103, 201, 202, 300, 400, 500 e 900.`,
        );
    }
  }

  switch (icms.cst) {
    case '00': {
      const p = calcularIcmsProprio(icms, base);
      return {
        ICMS00: {
          orig,
          CST: '00',
          modBC: icms.modBC ?? '3',
          vBC: p.vBC,
          pICMS: icms.pICMS ?? '0.00',
          vICMS: p.vICMS,
        },
      };
    }
    case '10': {
      const p = calcularIcmsProprio(icms, base);
      const st = calcularIcmsSt(icms, base, vIPI, p.vICMS);
      return {
        ICMS10: {
          orig,
          CST: '10',
          modBC: icms.modBC ?? '3',
          vBC: p.vBC,
          pICMS: icms.pICMS ?? '0.00',
          vICMS: p.vICMS,
          modBCST: icms.modBCST ?? '4',
          pMVAST: icms.pMVAST,
          pRedBCST: icms.pRedBCST,
          vBCST: st.vBCST,
          pICMSST: icms.pICMSST ?? '0.00',
          vICMSST: st.vICMSST,
        },
      };
    }
    case '20': {
      const p = calcularIcmsProprio(icms, base);
      return {
        ICMS20: {
          orig,
          CST: '20',
          modBC: icms.modBC ?? '3',
          pRedBC: icms.pRedBC ?? '0.00',
          vBC: p.vBC,
          pICMS: icms.pICMS ?? '0.00',
          vICMS: p.vICMS,
          vICMSDeson: icms.vICMSDeson,
          motDesICMS: icms.motDesICMS,
        },
      };
    }
    case '40':
    case '41':
    case '50':
      return {
        ICMS40: {
          orig,
          CST: icms.cst as '40' | '41' | '50',
          vICMSDeson: icms.vICMSDeson,
          motDesICMS: icms.motDesICMS,
        },
      };
    case '60':
      return {
        ICMS60: {
          orig,
          CST: '60',
          vBCSTRet: icms.vBCSTRet,
          vICMSSTRet: icms.vICMSSTRet,
        },
      };
    case '70': {
      const p = calcularIcmsProprio(icms, base);
      const st = calcularIcmsSt(icms, base, vIPI, p.vICMS);
      return {
        ICMS70: {
          orig,
          CST: '70',
          modBC: icms.modBC ?? '3',
          pRedBC: icms.pRedBC ?? '0.00',
          vBC: p.vBC,
          pICMS: icms.pICMS ?? '0.00',
          vICMS: p.vICMS,
          modBCST: icms.modBCST ?? '4',
          pMVAST: icms.pMVAST,
          pRedBCST: icms.pRedBCST,
          vBCST: st.vBCST,
          pICMSST: icms.pICMSST ?? '0.00',
          vICMSST: st.vICMSST,
          vICMSDeson: icms.vICMSDeson,
          motDesICMS: icms.motDesICMS,
        },
      };
    }
    case '30': {
      // Isenta/nao tributada COM ST cobrada anteriormente. O proprio nao sai;
      // a ST, sim.
      const st = calcularIcmsSt(icms, base, vIPI, '0.00');
      return {
        ICMS30: {
          orig,
          CST: '30',
          modBCST: icms.modBCST ?? '4',
          pMVAST: icms.pMVAST,
          pRedBCST: icms.pRedBCST,
          vBCST: st.vBCST,
          pICMSST: icms.pICMSST ?? '0.00',
          vICMSST: st.vICMSST,
          vICMSDeson: icms.vICMSDeson,
          motDesICMS: icms.motDesICMS,
        },
      };
    }
    case '51': {
      // Diferimento: calcula o imposto da operacao e separa quanto fica para
      // depois. `vICMS` e o que se paga AGORA — operacao menos diferido.
      const p = calcularIcmsProprio(icms, base);
      const vOp = icms.vICMSOp ?? p.vICMS;
      const pDif = icms.pDif;
      const vDif = icms.vICMSDif
        ?? (pDif ? new Decimal(vOp).mul(new Decimal(pDif)).div(100).toFixed(2) : undefined);
      const vAgora = icms.vICMS
        ?? (vDif ? new Decimal(vOp).minus(new Decimal(vDif)).toFixed(2) : undefined);
      return {
        ICMS51: {
          orig,
          CST: '51',
          modBC: icms.modBC ?? '3',
          pRedBC: icms.pRedBC,
          vBC: p.vBC,
          pICMS: icms.pICMS,
          vICMSOp: vOp,
          pDif,
          vICMSDif: vDif,
          vICMS: vAgora,
        },
      };
    }
    case '90': {
      // "Outras". Mesmo criterio do CSOSN 900: so vai o que foi informado.
      const p = calcularIcmsProprio(icms, base);
      const temProprio = icms.pICMS != null || icms.vBC != null;
      const temSt = icms.vBCST != null || icms.pICMSST != null || icms.pMVAST != null;
      const st = temSt ? calcularIcmsSt(icms, base, vIPI, temProprio ? p.vICMS : '0.00') : undefined;
      return {
        ICMS90: {
          orig,
          CST: '90',
          ...(temProprio ? {
            modBC: icms.modBC ?? '3',
            vBC: p.vBC,
            pRedBC: icms.pRedBC,
            pICMS: icms.pICMS ?? '0.00',
            vICMS: p.vICMS,
          } : {}),
          ...(st ? {
            modBCST: icms.modBCST ?? '4',
            pMVAST: icms.pMVAST,
            pRedBCST: icms.pRedBCST,
            vBCST: st.vBCST,
            pICMSST: icms.pICMSST ?? '0.00',
            vICMSST: st.vICMSST,
          } : {}),
        },
      };
    }
    // Monofasicos de combustivel. Nao ha calculo aqui de proposito: a base e a
    // QUANTIDADE e o valor por unidade vem da tabela do combustivel, que o
    // motor nao tem. Faltando o dado, recusa nomeando o campo — inventar
    // aliquota ad rem seria errar tributo em regime que nem usa base.
    case '02': {
      exigirMonofasico(icms, ['adRemICMS', 'vICMSMono'], '02');
      return {
        ICMS02: {
          orig, CST: '02',
          qBCMono: icms.qBCMono,
          adRemICMS: icms.adRemICMS!,
          vICMSMono: icms.vICMSMono!,
        },
      };
    }
    case '15': {
      exigirMonofasico(icms, ['adRemICMS', 'vICMSMono', 'adRemICMSReten', 'vICMSMonoReten'], '15');
      return {
        ICMS15: {
          orig, CST: '15',
          qBCMono: icms.qBCMono,
          adRemICMS: icms.adRemICMS!,
          vICMSMono: icms.vICMSMono!,
          qBCMonoReten: icms.qBCMonoReten,
          adRemICMSReten: icms.adRemICMSReten!,
          vICMSMonoReten: icms.vICMSMonoReten!,
          pRedAdRem: icms.pRedAdRem,
          motRedAdRem: icms.motRedAdRem,
        },
      };
    }
    case '53': {
      return {
        ICMS53: {
          orig, CST: '53',
          qBCMono: icms.qBCMono,
          adRemICMS: icms.adRemICMS,
          vICMSMonoOp: icms.vICMSMonoOp,
          pDif: icms.pDif,
          vICMSMonoDif: icms.vICMSMonoDif,
          vICMSMono: icms.vICMSMono,
        },
      };
    }
    case '61': {
      exigirMonofasico(icms, ['adRemICMSRet', 'vICMSMonoRet'], '61');
      return {
        ICMS61: {
          orig, CST: '61',
          qBCMonoRet: icms.qBCMonoRet,
          adRemICMSRet: icms.adRemICMSRet!,
          vICMSMonoRet: icms.vICMSMonoRet!,
        },
      };
    }
    default:
      // Aqui morava o pior default do motor: CST desconhecido — ou item que
      // chegou sem CST nenhum — virava <ICMSSN102><CSOSN>102</CSOSN>, ou seja, o
      // emissor trocava o regime tributario do item por conta propria. Quando o
      // codigo forjado nao existia na enum, a rejeicao falava de "CSOSN" numa
      // empresa de regime normal; quando existia, a nota saia AUTORIZADA com uma
      // tributacao que ninguem escolheu.
      throw new ErroDeDados(
        icms.cst
          ? `ICMS: CST ${icms.cst} ainda nao e suportado por este emissor. ` +
            `Suportados hoje: 00, 02, 10, 15, 20, 30, 40, 41, 50, 51, 53, 60, 61, 70 e 90.`
          : 'ICMS: o item nao informou CST nem CSOSN. Informe um dos dois — ' +
            'CST para regime normal (CRT 3), CSOSN para o Simples (CRT 1/2).',
      );
  }
}

/** CSOSN da tabela do Ajuste SINIEF. */
const CSOSN_VALIDOS = new Set(['101', '102', '103', '201', '202', '203', '300', '400', '500', '900']);
/** CST de ICMS do leiaute 4.00. */
const CST_ICMS_VALIDOS = new Set(['00', '10', '20', '30', '40', '41', '50', '51', '60', '70', '90']);

/**
 * Quem usa CSOSN e quem usa CST — pelo CRT, nao pela intuicao.
 *
 * A divisao NAO e "Simples x normal", e foi assim que eu errei na primeira
 * versao desta funcao. O MOC 7.0 Anexo I amarra pelo numero do CRT:
 *
 *   - CRT 1 (Simples) e CRT 4 (MEI)  -> CSOSN. CST aqui e a rejeicao 590.
 *   - CRT 2 e CRT 3                  -> CST.   CSOSN aqui e a rejeicao 591.
 *
 * O CRT 2 e "Simples Nacional, excesso de sublimite de receita bruta", e cai no
 * lado do CST justamente porque, excedido o sublimite, o ICMS deixa de ser
 * recolhido dentro do DAS (Res. CGSN 140/2018 art. 12) e passa a seguir as
 * normas das empresas nao optantes. O documento fiscal acompanha o regime.
 *
 * A NT 2024.001 acrescentou o CRT 4 ao lado do CSOSN — antes dela o texto das
 * regras dizia so "CRT=1" / "CRT diferente de 1".
 */
const CRT_DE_CSOSN = new Set(['1', '4']);

/**
 * CST de tributacao monofasica sobre combustiveis.
 *
 * Excecao expressa da regra N12-20: estes CST valem TAMBEM para CRT 1 e 4, e
 * recusa-los quebraria posto de combustivel optante pelo Simples.
 */
const CST_MONOFASICO_COMBUSTIVEL = new Set(['02', '15', '53', '61']);

/**
 * CSOSN que o MEI pode usar, por modelo (regra N12a-80/81, rejeicao 782).
 * Obrigatoria em producao desde 01/04/2025 — nao e "a criterio da UF".
 */
const CSOSN_DO_MEI: Record<string, Set<string>> = {
  '55': new Set(['102', '300', '400', '900']),
  '65': new Set(['102', '300']),
};

const NOME_DO_CRT: Record<string, string> = {
  '1': 'Simples Nacional (CRT 1)',
  '2': 'Simples Nacional com excesso de sublimite (CRT 2)',
  '3': 'Regime Normal (CRT 3)',
  '4': 'MEI (CRT 4)',
};

/**
 * O codigo de ICMS do item tem que combinar com o regime da empresa.
 *
 * Dois erros comuns, nenhum era pego, os dois com previa verde: o XSD aceita os
 * dois grupos — quem recusa e a regra de negocio da SEFAZ, nao o schema. E o
 * dado para decidir ja esta em maos desde o cadastro.
 *
 * Recusa em vez de converter: CST e CSOSN nao tem equivalencia de mao dupla, e
 * adivinhar a correspondencia mudaria o imposto.
 */
function conferirRegimeDoIcms(
  icms: FiscalContextICMS,
  crt: string,
  nItem: number,
  mod: string,
): void {
  const usaCsosn = CRT_DE_CSOSN.has(crt);
  const regime = NOME_DO_CRT[crt] ?? `CRT ${crt}`;

  if (usaCsosn && icms.cst && !icms.csosn) {
    // Posto de combustivel optante pelo Simples usa CST monofasico e esta certo.
    if (!CST_MONOFASICO_COMBUSTIVEL.has(icms.cst)) {
      throw new ErroDeDados(
        `item ${nItem}: CST ${icms.cst} de ICMS em empresa do ${regime}. ` +
        `Aqui o codigo e CSOSN (${[...CSOSN_VALIDOS].join(', ')}), nao CST — ` +
        'a SEFAZ recusa com a rejeicao 590.',
      );
    }
  }
  if (!usaCsosn && icms.csosn) {
    throw new ErroDeDados(
      `item ${nItem}: CSOSN ${icms.csosn} em empresa de ${regime}. ` +
      `Aqui o codigo e CST (${[...CST_ICMS_VALIDOS].join(', ')}), nao CSOSN — ` +
      'a SEFAZ recusa com a rejeicao 591.' +
      (crt === '2'
        ? ' No CRT 2 o ICMS saiu do DAS e segue as regras de quem nao e optante.'
        : ''),
    );
  }

  // Codigo com o numero de digitos do outro regime e quase sempre a coluna
  // trocada no cadastro — `cst_csosn` guarda os dois tipos. Vale nomear, porque
  // a mensagem generica mandaria a pessoa procurar no lugar errado.
  if (icms.csosn && !CSOSN_VALIDOS.has(icms.csosn)) {
    throw new ErroDeDados(
      `item ${nItem}: CSOSN ${icms.csosn} nao existe na tabela do Simples Nacional.` +
      (icms.csosn.length === 2 ? ' Parece um CST de regime normal salvo no campo do CSOSN.' : ''),
    );
  }
  if (icms.cst && !CST_ICMS_VALIDOS.has(icms.cst) && !CST_MONOFASICO_COMBUSTIVEL.has(icms.cst)) {
    throw new ErroDeDados(
      `item ${nItem}: CST ${icms.cst} nao existe na tabela de ICMS.` +
      (icms.cst.length === 3 ? ' Parece um CSOSN do Simples salvo no campo do CST.' : ''),
    );
  }

  // O MEI e mais restrito que o Simples comum, e a diferenca muda por modelo.
  if (crt === '4' && icms.csosn) {
    const permitidos = CSOSN_DO_MEI[mod] ?? CSOSN_DO_MEI['55']!;
    if (!permitidos.has(icms.csosn)) {
      throw new ErroDeDados(
        `item ${nItem}: CSOSN ${icms.csosn} nao vale para MEI. ` +
        `${mod === '65' ? 'Na NFC-e' : 'Na NF-e'} o MEI so pode usar ` +
        `${[...permitidos].join(', ')} — a SEFAZ recusa com a rejeicao 782.`,
      );
    }
  }
}

/** CSTs de PIS/COFINS que vão nos grupos PISNT/COFINSNT (só o CST, sem valores). */
const CST_NAO_TRIBUTADO = ['04', '05', '06', '07', '08'];

function buildPIS(pis: FiscalContextPIS, vProd: Decimal): TipoPIS {
  if (pis.cst === '01' || pis.cst === '02') {
    const aliq = new Decimal(pis.aliquota ?? '0');
    const vBC = vProd;
    const vPIS = vBC.mul(aliq).div(100);
    return {
      PISAliq: {
        CST: pis.cst as '01' | '02',
        vBC: vBC.toFixed(2),
        pPIS: aliq.toFixed(4),
        vPIS: vPIS.toFixed(2),
      },
    };
  }
  // CST 04 a 08 pertencem a PISNT, que só leva o CST. Cair em PISOutr aqui
  // trocaria "isenta" por "outras operações" — a nota autoriza e sai errada.
  if (CST_NAO_TRIBUTADO.includes(pis.cst)) {
    return { PISNT: { CST: pis.cst as PISNT_Props['CST'] } };
  }
  return {
    PISOutr: {
      CST: pis.cst || '99',
      vBC: vProd.toFixed(2),
      pPIS: new Decimal(pis.aliquota ?? '0').toFixed(4),
      vPIS: vProd.mul(new Decimal(pis.aliquota ?? '0')).div(100).toFixed(2),
    },
  };
}

function buildCOFINS(cofins: FiscalContextCOFINS, vProd: Decimal): TipoCOFINS {
  if (cofins.cst === '01' || cofins.cst === '02') {
    const aliq = new Decimal(cofins.aliquota ?? '0');
    const vBC = vProd;
    const vCOFINS = vBC.mul(aliq).div(100);
    return {
      COFINSAliq: {
        CST: cofins.cst as '01' | '02',
        vBC: vBC.toFixed(2),
        pCOFINS: aliq.toFixed(4),
        vCOFINS: vCOFINS.toFixed(2),
      },
    };
  }
  if (CST_NAO_TRIBUTADO.includes(cofins.cst)) {
    return { COFINSNT: { CST: cofins.cst as COFINSNT_Props['CST'] } };
  }
  return {
    COFINSOutr: {
      CST: cofins.cst || '99',
      vBC: vProd.toFixed(2),
      pCOFINS: new Decimal(cofins.aliquota ?? '0').toFixed(4),
      vCOFINS: vProd.mul(new Decimal(cofins.aliquota ?? '0')).div(100).toFixed(2),
    },
  };
}

/**
 * Normaliza as chaves de NF-e referenciadas (grupo NFref).
 *
 * Aceita string única ou lista, e limpa a formatação — chave copiada de tela
 * costuma vir com espaços. Valida aqui porque chave malformada só apareceria
 * como rejeição de schema da SEFAZ, que não diz qual campo falhou.
 */
function normalizarNotasReferenciadas(valor: unknown): string[] | undefined {
  if (!valor) return undefined;
  const lista = Array.isArray(valor) ? valor : [valor];
  const chaves = lista
    .map(v => String(v ?? '').replace(/\D/g, ''))
    .filter(Boolean);
  if (!chaves.length) return undefined;

  const invalida = chaves.find(c => c.length !== 44);
  if (invalida) {
    throw new Error(
      `Chave de nota referenciada invalida: "${invalida}" tem ${invalida.length} digitos, esperado 44.`,
    );
  }
  if (chaves.length > 999) {
    throw new Error('NFref aceita no maximo 999 notas referenciadas.');
  }
  return chaves;
}

// === Reforma Tributaria (EC 132/2023, LC 214/2025, NT 2025.002) ===
//
// 2026 e ano de transicao: as aliquotas sao simbolicas e nao geram recolhimento
// (LC 214/2025 dispensa o pagamento de quem emitir os documentos corretamente).
//
// O destaque JA FOI obrigatorio no papel e nao e mais, hoje: o Ato Tecnico
// Conjunto RFB/CGIBS 1/2026 (31/07/2026) adiou as validacoes de IBS/CBS nos
// DF-e, e a NT 2025.002 v1.51 moveu a regra UB12-10 (rejeicao 1115) para
// "implementacao futura". A nota de esclarecimento de 06/08/2026 deixou claro
// que caiu a REJEICAO, nao o dever de destacar.
//
// Para optante do Simples (CRT 1/2) a exigencia nem comecou: Ato Conjunto
// RFB/CGIBS 4/2026, art. 1o, par. 1o, so obriga a partir de 01/01/2027.
//
// A consequencia pratica inverteu, e e ela que manda no codigo abaixo: hoje
// NAO informar o grupo passa; informar ERRADO rejeita, porque grupo presente
// atrai todas as regras de validacao dele.
export const IBSCBS_ALIQUOTAS_2026 = {
  pIBSUF: '0.1000',   // IBS estadual — 0,1%
  pIBSMun: '0.0000',  // IBS municipal — 0% na fase de teste
  pCBS: '0.9000',     // CBS federal — 0,9%
};

// CST 000 + cClassTrib 000001 = tributacao integral, o caso da venda comum de
// mercadoria. Operacoes com tratamento proprio (isencao, imunidade, monofasia)
// exigem outro par e devem informa-lo no item.
/** Limite de infCpl no leiaute 4.00 — acima disso a SEFAZ rejeita com 215. */
const LIMITE_INF_CPL = 5000;

const IBSCBS_CST_PADRAO = '000';
const IBSCBS_CLASSTRIB_PADRAO = '000001';

/**
 * CST que representam tributacao com a aliquota cheia.
 *
 * Fora desta lista o item nao e tributado integralmente, e destacar a aliquota
 * de transicao nele produz contradicao dentro da propria linha: um CST que diz
 * "nao tributado" com valor de tributo ao lado.
 */
const IBSCBS_CST_TRIBUTADOS = new Set(['000', '010', '011']);

/** CST 200 = aliquota reduzida. E o unico que exige o grupo gRed. */
const IBSCBS_CST_REDUZIDO = '200';

/**
 * Erro de dado enviado pelo cliente, e nao falha do servidor.
 *
 * A distincao existe porque muda o codigo HTTP: 500 diz "tente de novo, o
 * problema e nosso" e faz o ERP entrar em retry por um cadastro errado que
 * nunca vai se corrigir sozinho. 400 diz "conserte e mande de novo".
 */
export class ErroDeDados extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDeDados';
  }
}

/**
 * Percentual de reducao por cClassTrib.
 *
 * So entram codigos conferidos na tabela oficial da RTC. Deliberadamente curta:
 * chutar reducao e errar tributo, e a tabela completa tem centenas de linhas que
 * mudam por Nota Tecnica. Codigo que nao esteja aqui exige `pRedAliq` no item —
 * o motor recusa em vez de adivinhar.
 */
const IBSCBS_REDUCAO_POR_CLASSTRIB: Record<string, string> = {
  // Horticolas, frutas e ovos — LC 214/2025 art. 148 e Anexo XV.
  // Confere com a base publicada pela SVRS: PercRedIbs 100 e PercRedCbs 100.
  '200014': '100',
};

/**
 * Reducao de aliquota do item, quando o CST for 200.
 *
 * Ordem: o que o item mandou vence a tabela. Nenhum dos dois disponivel e erro
 * de verdade — nao da para emitir CST 200 sem dizer quanto reduz.
 */
function reducaoIbsCbs(cClassTrib: string, informado?: string): Decimal {
  const valor = informado ?? IBSCBS_REDUCAO_POR_CLASSTRIB[cClassTrib];
  if (valor == null) {
    throw new ErroDeDados(
      `IBS/CBS: CST 200 (aliquota reduzida) exige o percentual de reducao, e o cClassTrib ${cClassTrib} ` +
      `nao esta na tabela embutida. Informe itens[].ibscbs.pRedAliq (ex.: "100" para aliquota zero), ` +
      `com o percentual da tabela oficial de cClassTrib da RTC.`,
    );
  }
  const pRed = new Decimal(valor);
  if (pRed.lt(0) || pRed.gt(100)) {
    throw new ErroDeDados(`IBS/CBS: pRedAliq deve ficar entre 0 e 100; veio "${valor}".`);
  }
  return pRed;
}

function buildIBSCBS(item: FiscalContextItem, vProd: Decimal): ImpostoIBSCBS {
  const cfg = item.ibscbs;
  const CST = cfg?.cst ?? IBSCBS_CST_PADRAO;

  // cClassTrib nao pode herdar o padrao quando o CST foi trocado: o par
  // 200/000001 nao existe na tabela, e a regra da NT amarra os tres primeiros
  // digitos do cClassTrib ao CST (rejeicao 1024). O erro e facil de cometer
  // porque os dois campos sao digitados separados.
  const cClassTrib = cfg?.cClassTrib ?? (cfg?.cst ? '' : IBSCBS_CLASSTRIB_PADRAO);
  if (!cClassTrib) {
    throw new ErroDeDados(
      `IBS/CBS: o item informou cst "${CST}" sem cClassTrib. Os dois andam juntos — ` +
      `o cClassTrib comeca pelos tres digitos do CST (ex.: CST 200 e cClassTrib 200014).`,
    );
  }
  if (cClassTrib.slice(0, 3) !== CST) {
    throw new ErroDeDados(
      `IBS/CBS: cClassTrib ${cClassTrib} nao combina com o CST ${CST}. Os tres primeiros digitos do ` +
      `cClassTrib sao o proprio CST — do jeito que esta, a SEFAZ rejeita com 1024.`,
    );
  }

  // Base de calculo: valor do produto. Frete/seguro/desconto entram aqui quando
  // existirem no item — hoje o motor rateia esses valores fora do item.
  const vBC = cfg?.vBC ? new Decimal(cfg.vBC) : vProd;

  const pIBSUF = new Decimal(cfg?.pIBSUF ?? IBSCBS_ALIQUOTAS_2026.pIBSUF);
  const pIBSMun = new Decimal(cfg?.pIBSMun ?? IBSCBS_ALIQUOTAS_2026.pIBSMun);
  const pCBS = new Decimal(cfg?.pCBS ?? IBSCBS_ALIQUOTAS_2026.pCBS);

  // Quanto sobra da aliquota depois da reducao. Sem CST 200 nao ha reducao, e o
  // fator e 1 — o item paga a aliquota cheia.
  const reduz = CST === IBSCBS_CST_REDUZIDO;
  const pRed = reduz ? reducaoIbsCbs(cClassTrib, cfg?.pRedAliq) : new Decimal(0);
  const fator = new Decimal(100).minus(pRed).div(100);

  // CST fora da tributacao integral nao destaca valor. Antes daqui o motor
  // aplicava 0,1% e 0,9% qualquer que fosse o CST: quem pedia CST 200 recebia
  // uma nota dizendo "aliquota reduzida" com o tributo cheio destacado ao lado.
  const tributa = IBSCBS_CST_TRIBUTADOS.has(CST) || reduz;

  const efetiva = (p: Decimal) => (tributa ? p.mul(fator) : new Decimal(0));
  const pEfIBSUF = efetiva(pIBSUF);
  const pEfIBSMun = efetiva(pIBSMun);
  const pEfCBS = efetiva(pCBS);

  const vIBSUF = vBC.mul(pEfIBSUF).div(100);
  const vIBSMun = vBC.mul(pEfIBSMun).div(100);
  const vCBS = vBC.mul(pEfCBS).div(100);

  // gRed so existe quando ha reducao — e ai e obrigatorio (CST 200 tem
  // IndReducaoAliq verdadeiro na tabela oficial).
  const gRed = (pEfetiva: Decimal) =>
    reduz ? { gRed: { pRedAliq: pRed.toFixed(4), pAliqEfet: pEfetiva.toFixed(4) } } : {};

  return {
    CST,
    cClassTrib,
    gIBSCBS: {
      vBC: vBC.toFixed(2),
      gIBSUF: { pIBSUF: pIBSUF.toFixed(4), ...gRed(pEfIBSUF), vIBSUF: vIBSUF.toFixed(2) },
      gIBSMun: { pIBSMun: pIBSMun.toFixed(4), ...gRed(pEfIBSMun), vIBSMun: vIBSMun.toFixed(2) },
      vIBS: vIBSUF.plus(vIBSMun).toFixed(2),
      gCBS: { pCBS: pCBS.toFixed(4), ...gRed(pEfCBS), vCBS: vCBS.toFixed(2) },
    },
  };
}

function buildIPI(ipi: FiscalContextIPI, vProd: Decimal): TipoIPI {
  const cEnq = ipi.cEnq ?? '999';
  const cst = ipi.cst;
  if (cst === '50' || cst === '49' || cst === '99') {
    const vBC = new Decimal(ipi.vBC ?? vProd.toFixed(2));
    const pIPI = new Decimal(ipi.pIPI ?? '0');
    const vIPI = ipi.vIPI ? new Decimal(ipi.vIPI) : vBC.mul(pIPI).div(100);
    return {
      IPITrib: {
        CST: cst as '50' | '49' | '99',
        cEnq,
        vBC: vBC.toFixed(2),
        pIPI: pIPI.toFixed(2),
        vIPI: vIPI.toFixed(2),
      },
    };
  }
  return {
    IPINT: {
      CST: (cst || '53') as '51' | '52' | '53' | '54' | '55',
      cEnq,
    },
  };
}

interface ICMSExtracted { vBC: Decimal; vICMS: Decimal; vICMSDeson: Decimal; vBCST: Decimal; vST: Decimal }

function extractICMSValues(icms: TipoICMS): ICMSExtracted {
  const zero = { vBC: new Decimal('0'), vICMS: new Decimal('0'), vICMSDeson: new Decimal('0'), vBCST: new Decimal('0'), vST: new Decimal('0') };
  if ('ICMS00' in icms) {
    return { ...zero, vBC: new Decimal(icms.ICMS00.vBC), vICMS: new Decimal(icms.ICMS00.vICMS) };
  }
  if ('ICMS10' in icms) {
    return { ...zero, vBC: new Decimal(icms.ICMS10.vBC), vICMS: new Decimal(icms.ICMS10.vICMS), vBCST: new Decimal(icms.ICMS10.vBCST), vST: new Decimal(icms.ICMS10.vICMSST) };
  }
  if ('ICMS20' in icms) {
    return { ...zero, vBC: new Decimal(icms.ICMS20.vBC), vICMS: new Decimal(icms.ICMS20.vICMS), vICMSDeson: new Decimal(icms.ICMS20.vICMSDeson ?? '0') };
  }
  if ('ICMS40' in icms) {
    return { ...zero, vICMSDeson: new Decimal(icms.ICMS40.vICMSDeson ?? '0') };
  }
  if ('ICMS60' in icms) {
    return zero;
  }
  if ('ICMS70' in icms) {
    return { ...zero, vBC: new Decimal(icms.ICMS70.vBC), vICMS: new Decimal(icms.ICMS70.vICMS), vBCST: new Decimal(icms.ICMS70.vBCST), vST: new Decimal(icms.ICMS70.vICMSST), vICMSDeson: new Decimal(icms.ICMS70.vICMSDeson ?? '0') };
  }
  if ('ICMSSN201' in icms) {
    return { ...zero, vBCST: new Decimal(icms.ICMSSN201.vBCST), vST: new Decimal(icms.ICMSSN201.vICMSST) };
  }
  return zero;
}

/** Extract vPIS from a TipoPIS discriminated union */
function extractPISValue(pis: TipoPIS): Decimal {
  if ('PISAliq' in pis) return new Decimal(pis.PISAliq.vPIS);
  if ('PISOutr' in pis) return new Decimal(pis.PISOutr.vPIS ?? '0');
  return new Decimal(0); // PISNT — não tributado, não soma ao total
}

/** Extract vCOFINS from a TipoCOFINS discriminated union */
function extractCOFINSValue(cofins: TipoCOFINS): Decimal {
  if ('COFINSAliq' in cofins) return new Decimal(cofins.COFINSAliq.vCOFINS);
  if ('COFINSOutr' in cofins) return new Decimal(cofins.COFINSOutr.vCOFINS ?? '0');
  return new Decimal(0); // COFINSNT
}

function extractIPIValue(ipi: TipoIPI): Decimal {
  if ('IPITrib' in ipi) return new Decimal(ipi.IPITrib.vIPI ?? '0');
  return new Decimal('0');
}

// Alíquota interestadual ICMS (Resolução SF 22/89: 7% ou 12%; Resolução SF 13/2012: 4% p/ importados)
export function getAliqInterestadual(ufOrigem: string, ufDest: string, origemMercadoria: string): string {
  // Mercadoria estrangeira/importada (orig 1, 2, 3, 8): 4% em qualquer rota interestadual
  if (['1', '2', '3', '8'].includes(origemMercadoria)) return '4';
  const sulSudeste = ['MG', 'ES', 'RJ', 'SP', 'PR', 'SC', 'RS'];
  const norteNordesteCoEs = !sulSudeste.includes(ufDest) || ufDest === 'ES';
  // Sul/Sudeste (exceto ES) -> Norte/Nordeste/CO/ES: 7%; demais rotas: 12%
  if (sulSudeste.includes(ufOrigem) && ufOrigem !== 'ES' && norteNordesteCoEs) return '7';
  return '12';
}

function buildICMSUFDest(vBC: Decimal, pICMSUFDest: string, pICMSInter: string, pFCPUFDest?: string): ICMSUFDest_Props {
  const pDest = new Decimal(pICMSUFDest);
  const pInter = new Decimal(pICMSInter);
  const pPart = new Decimal('100'); // EC 87/2015: 100% destino a partir de 2019
  const diff = pDest.minus(pInter);
  const vICMSUFDest = vBC.mul(diff).mul(pPart).div(10000);
  const vICMSUFRemet = vBC.mul(diff).mul(new Decimal('100').minus(pPart)).div(10000);
  const pFCP = new Decimal(pFCPUFDest ?? '0');
  const vFCPUFDest = vBC.mul(pFCP).div(100);
  return {
    vBCUFDest: vBC.toFixed(2),
    vBCFCPUFDest: pFCP.gt(0) ? vBC.toFixed(2) : undefined,
    pFCPUFDest: pFCP.gt(0) ? pFCP.toFixed(2) : undefined,
    pICMSUFDest: pDest.toFixed(2),
    pICMSInter: pInter.toFixed(2),
    pICMSInterPart: pPart.toFixed(2),
    vFCPUFDest: pFCP.gt(0) ? vFCPUFDest.toFixed(2) : undefined,
    vICMSUFDest: vICMSUFDest.toFixed(2),
    vICMSUFRemet: vICMSUFRemet.toFixed(2),
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Limites de texto do leiaute 4.00, para os campos que vêm do cadastro.
 *
 * A SEFAZ recusa quem passa do limite com cStat 225 — "Falha no Schema XML" —
 * sem dizer o campo. Aconteceu em produção com uma razão social de 68
 * caracteres: a empresa não conseguia emitir **nenhuma** nota, e o erro não
 * dava pista nenhuma de onde olhar.
 */
const LIMITES_TEXTO = {
  xNome: 60, xFant: 60, xLgr: 60, xBairro: 60, xMun: 60, xCpl: 60,
  natOp: 60, xProd: 120,
} as const;

/**
 * Mínimos do leiaute. Vários campos de texto exigem 2 caracteres.
 *
 * Não dá para completar por conta própria — "C" não vira "Centro" por adivinhação
 * — então aqui a saída é recusar dizendo o campo, em vez de deixar a SEFAZ
 * responder o mesmo cStat 225 genérico.
 */
const MINIMOS_TEXTO: Partial<Record<keyof typeof LIMITES_TEXTO, number>> = {
  xNome: 2, xLgr: 2, xBairro: 2,
};

const NOME_AMIGAVEL: Record<string, string> = {
  xNome: 'razão social', xFant: 'nome fantasia', xLgr: 'logradouro',
  xBairro: 'bairro', xMun: 'município', xCpl: 'complemento',
  natOp: 'natureza da operação', xProd: 'descrição do produto',
};

/**
 * Encurta o texto ao limite do schema.
 *
 * Truncar não é palpite: acima do limite não existe nota possível, e recusar
 * deixaria a empresa sem emitir. É o que todo emissor faz — a razão social
 * completa continua no cadastro e no DANFE, que não tem essa restrição.
 */
function limitarTexto(valor: string | undefined, campo: keyof typeof LIMITES_TEXTO): string | undefined {
  if (valor === undefined || valor === null) return valor;
  const texto = String(valor).trim();

  // Curto demais não tem conserto automático: recusa dizendo qual campo.
  //
  // VAZIO conta como curto. A guarda tinha `texto.length > 0`, então logradouro
  // `""` — o ERP que manda o campo em branco — atravessava calado: o `addOpt`
  // apagava a tag do XML e a SEFAZ devolvia 225 apontando o campo SEGUINTE ao
  // que faltou. Ou seja, exatamente o erro cego que esta função existe para
  // evitar. Todos os campos com mínimo são obrigatórios no leiaute.
  const min = MINIMOS_TEXTO[campo];
  if (min && texto.length < min) {
    const nome = NOME_AMIGAVEL[campo] || campo;
    throw new Error(
      texto.length === 0
        ? `TEXTO_CURTO: o campo "${nome}" veio vazio, e o leiaute exige ao menos `
          + `${min} caracteres. Vazio não é o mesmo que ausente: a tag some do XML e `
          + 'a SEFAZ reclama do campo seguinte (cStat 225).'
        : `TEXTO_CURTO: o campo "${nome}" está com "${texto}" — `
          + `${texto.length} caractere(s), e o leiaute exige ao menos ${min}. `
          + 'Abreviações de uma letra são recusadas pela SEFAZ (cStat 225).',
    );
  }

  const max = LIMITES_TEXTO[campo];
  return texto.length > max ? texto.slice(0, max).trim() : texto;
}

/**
 * Campos de tamanho fixo do item, conferidos antes de montar o XML.
 *
 * A SEFAZ recusa formato errado com cStat 225 — "Falha no Schema XML do lote de
 * NFe" — e **não diz qual campo nem qual item**. Numa nota com dez produtos,
 * descobrir que foi o NCM do terceiro é procurar agulha no palheiro.
 *
 * O caso que motivou isto: NCM digitado como "9018902", com 7 dígitos. O padrão
 * do XSD é `[0-9]{2}|[0-9]{8}` — 8 dígitos, ou 2 quando a operação dispensa o
 * detalhamento. Sete não existe, e é o erro natural de quem copia um código de
 * subposição ("9018.90.2") em vez do código completo.
 */
function validarFormatosDoItem(item: FiscalContextItem, numero: number): void {
  const onde = `item ${numero}${item.descricao ? ` (${item.descricao})` : ''}`;

  const ncm = String(item.ncm ?? '').replace(/\D/g, '');
  if (ncm.length !== 8 && ncm.length !== 2) {
    throw new Error(
      `NCM_INVALIDO: ${onde} está com NCM "${item.ncm}" — ${ncm.length} dígito(s). `
      + 'O NCM tem 8 dígitos. Códigos como "9018.90.2" são de subposição e estão incompletos: '
      + 'falta o último par. Confira na busca de NCM ou com a contabilidade.',
    );
  }

  const cfop = String(item.cfop ?? '').replace(/\D/g, '');
  if (cfop.length !== 4) {
    throw new Error(
      `CFOP_INVALIDO: ${onde} está com CFOP "${item.cfop}" — o CFOP tem 4 dígitos.`,
    );
  }

  // CEST é opcional, mas quando vem tem tamanho fixo.
  if (item.cest) {
    const cest = String(item.cest).replace(/\D/g, '');
    if (cest.length !== 7) {
      throw new Error(
        `CEST_INVALIDO: ${onde} está com CEST "${item.cest}" — o CEST tem 7 dígitos. `
        + 'Deixe em branco se o produto não estiver sujeito à substituição tributária.',
      );
    }
  }

  // Quantidade e valor ZERADOS passam no XSD — os patterns de TDec_1104v,
  // TDec_1110v e TDec_1302 aceitam o zero explicitamente. A nota sai
  // AUTORIZADA valendo R$ 0,00, com numeração consumida e nada para cancelar
  // depois de 24h. Nenhuma rejeição avisa: é o desfecho mais caro possível.
  //
  // Ausente é igualmente silencioso na direção contrária: o `?? '1'` inventava
  // quantidade 1 e o `?? '0'` inventava preço zero. Campo ausente é ERP mal
  // integrado, e inventar produz uma nota errada que ninguém vai conferir.
  // `lerNumero`, e nao `numero`: o parametro da funcao ja se chama assim (o
  // indice do item), e sombrear o indice aqui apagaria o "item 3" da mensagem.
  const lerNumero = (valor: unknown, campo: string): Decimal => {
    const bruto = String(valor ?? '').trim();
    if (!bruto) {
      throw new Error(
        `${campo.toUpperCase()}_AUSENTE: ${onde} não informou ${campo}. `
        + 'O campo não tem padrão: inventar um valor emitiria uma nota com número que ninguém pediu.',
      );
    }
    let d: Decimal;
    try {
      d = new Decimal(bruto.replace(',', '.'));
    } catch {
      throw new Error(`${campo.toUpperCase()}_INVALIDO: ${onde} está com ${campo} "${bruto}", que não é número.`);
    }
    return d;
  };

  const quantidade = lerNumero(item.quantidade, 'quantidade');
  if (quantidade.lte(0)) {
    throw new Error(
      `QUANTIDADE_INVALIDA: ${onde} está com quantidade ${quantidade.toString()}. `
      + 'Quantidade zero ou negativa passa no schema e a nota é AUTORIZADA valendo R$ 0,00 — '
      + 'com a numeração consumida e nada para cancelar depois de 24h.',
    );
  }

  const unitario = lerNumero(item.valorUnitario, 'valorUnitario');
  if (unitario.lt(0)) {
    throw new Error(
      `VALOR_UNITARIO_INVALIDO: ${onde} está com valor unitário ${unitario.toString()}. `
      + 'Valor negativo não existe no leiaute — se a intenção é estorno, o caminho é '
      + 'nota de devolução (finalidade 4).',
    );
  }
  if (unitario.isZero()) {
    throw new Error(
      `VALOR_UNITARIO_ZERO: ${onde} está com valor unitário 0,00. `
      + 'A nota sairia AUTORIZADA valendo R$ 0,00. Se for brinde ou bonificação, '
      + 'informe o valor real do produto e use o CFOP de bonificação.',
    );
  }

  // A unidade comercial é o único campo de texto do item que ficou de fora do
  // tratamento por nome. Acima de 6 caracteres o schema recusa, e a mensagem do
  // libxml não diz qual item nem que o problema é o tamanho da unidade — e o
  // mesmo valor aparece duas vezes no XML, porque uCom é replicado em uTrib.
  //
  // Truncar sozinho seria arriscado: 'CAIXA' e 'CAIXA C/12' são quantidades
  // diferentes, e cortar mudaria o que está sendo vendido.
  const unidade = String(item.unidade ?? '').trim();
  if (unidade.length > 6) {
    throw new Error(
      `UNIDADE_INVALIDA: ${onde} está com unidade "${unidade}" — ${unidade.length} caracteres, `
      + 'e o leiaute aceita 6. Use a abreviação (CX, CX12, PC, KG); truncar aqui seria '
      + 'arriscado, porque "CAIXA" e "CAIXA C/12" são quantidades diferentes.',
    );
  }
}

export function buildNFe(input: FiscalContextInput): NFe {
  const cUF = UF_TO_IBGE[input.ufEmitente];
  if (!cUF) {
    throw new Error(`Unknown UF: ${input.ufEmitente}`);
  }

  const cNF = generateCNF();

  // Devolução referencia a nota de origem item a item; as demais finalidades
  // referenciam no cabeçalho. Ver o bloco de DFeReferenciado abaixo.
  const ehDevolucao = input.finalidade === '4';

  // Build items
  const detItems: DetalheItem[] = input.itens.map((item, index) => {
    validarFormatosDoItem(item, index + 1);
    // Arredondar ANTES de multiplicar, com as casas que o XML de fato leva.
    //
    // A SEFAZ refaz a conta com o que esta no XML. Quantidade '1.00005' com
    // unitario '1000.00' dava vProd 1000.05, mas o qCom gravado e '1.0001'
    // (o leiaute so tem 4 casas) — e 1.0001 x 1000 = 1000.10. Cinco centavos de
    // diferenca, rejeicao 526 "Valor do Produto difere do produto Valor Unitario
    // e Quantidade". O XSD nao pega porque os tres campos estao bem formados
    // isoladamente; so a relacao entre eles esta quebrada.
    //
    // Multiplicar os valores ja arredondados usa exatamente os numeros que a
    // SEFAZ vai usar, entao a conta dela e a nossa nunca divergem.
    const qCom = new Decimal(item.quantidade).toDecimalPlaces(4);
    const vUnCom = new Decimal(item.valorUnitario).toDecimalPlaces(10);
    const vProd = qCom.mul(vUnCom).toDecimalPlaces(2);
    const ean = item.ean ?? 'SEM GTIN';

    // O IPI é montado antes do ICMS porque a base da substituição tributária o
    // inclui — a ordem aqui é fiscal, não estilística.
    const ipi = item.ipi ? buildIPI(item.ipi, vProd) : undefined;
    const vIPI = new Decimal(
      (ipi && 'IPITrib' in ipi ? ipi.IPITrib?.vIPI : undefined) ?? '0',
    );

    // Base do ICMS pelo modBC 3, "valor da operação": os produtos menos o
    // desconto, mais frete, seguro e despesas acessórias rateados neste item.
    const baseIcms = vProd
      .minus(new Decimal(item.desconto ?? '0'))
      .plus(new Decimal(item.frete ?? '0'))
      .plus(new Decimal(item.seguro ?? '0'))
      .plus(new Decimal(item.despesas ?? '0'));

    // Antes de montar: o codigo de ICMS combina com o regime da empresa? O CRT
    // esta em maos desde o cadastro e ninguem conferia — grupo do Simples em
    // empresa normal (e vice-versa) passava no XSD e so a SEFAZ recusava.
    conferirRegimeDoIcms(item.icms, input.emitente.crt, index + 1, input.mod || '55');

    const icms = buildICMS(item.icms, baseIcms, vIPI);
    const pis = buildPIS(item.pis, vProd);
    const cofins = buildCOFINS(item.cofins, vProd);

    const prod: Produto = {
      // `cProd` é obrigatório no leiaute e é código interno do emitente — não
      // é dado fiscal que precise vir de fora. Sem código, a SEFAZ devolvia
      // cStat 225 ("Falha no Schema XML do lote"), que não diz o campo e é
      // impossível de diagnosticar de fora. Numerar pela posição do item é o
      // que todo emissor faz quando o produto não vem de um catálogo.
      cProd: String(item.codigo ?? '').trim() || String(index + 1).padStart(3, '0'),
      cEAN: ean,
      xProd: limitarTexto(item.descricao, 'xProd')!,
      // Só dígitos: o código circula pontuado ("9018.90.29") e é assim que
      // chega quando alguém copia da consulta. A validação acima já conferia
      // sem a pontuação, mas o valor ia cru para o XML e o ponto quebrava o
      // schema do mesmo jeito.
      NCM: item.ncm.replace(/\D/g, ''),
      CEST: item.cest ? item.cest.replace(/\D/g, '') : undefined,
      // O painel manda o cBenef dentro do grupo de ICMS, que é onde ele não vai:
      // o leiaute o coloca em `prod`. Aceitar os dois lugares evita perder o
      // campo por causa de onde quem chama achou que ele ficava.
      cBenef: item.cBenef ?? item.icms?.cBenef,
      CFOP: item.cfop.replace(/\D/g, ''),
      uCom: item.unidade,
      qCom: qCom.toFixed(4),
      vUnCom: vUnCom.toFixed(10),
      vProd: vProd.toFixed(2),
      cEANTrib: ean,
      uTrib: item.unidade,
      qTrib: qCom.toFixed(4),
      vUnTrib: vUnCom.toFixed(10),
      // Acessórios só entram no XML quando têm valor: elemento zerado é ruído
      // no DANFE e o leiaute os declara opcionais.
      vDesc: acessorioOuUndefined(item.desconto),
      vFrete: acessorioOuUndefined(item.frete),
      vSeg: acessorioOuUndefined(item.seguro),
      vOutro: acessorioOuUndefined(item.despesas),
      indTot: '1',
    };

    const imposto: ImpostoItem = {
      ICMS: icms,
      IPI: ipi,
      PIS: pis,
      COFINS: cofins,
      IBSCBS: buildIBSCBS(item, vProd),
    };

    // Documento referenciado por item — a SEFAZ exige na devolução (rejeição
    // 321) e proíbe combinar com o NFref do cabeçalho (rejeição 1010). Por isso
    // a referência é por item OU no cabeçalho, nunca nos dois.
    //
    // Com uma única nota de origem, replica em todos os itens: pedir que o ERP
    // repita a mesma chave item a item seria atrito sem ganho. O item pode
    // sobrescrever quando a devolução junta mercadoria de notas diferentes.
    const refsNota = normalizarNotasReferenciadas(input.notasReferenciadas);
    const refItem = !ehDevolucao ? undefined
      : item.notaReferenciada
        ? { chaveAcesso: String(item.notaReferenciada).replace(/\D/g, ''), nItem: item.itemReferenciado }
        : (refsNota?.length === 1 ? { chaveAcesso: refsNota[0], nItem: item.itemReferenciado } : undefined);

    return {
      nItem: String(index + 1),
      prod,
      imposto,
      DFeReferenciado: refItem,
    };
  });

  // DIFAL (EC 87/2015, regra NA01): idDest=2 + indFinal=1 + indIEDest=9
  const isInterestadual = input.destino === '2';
  const isConsumidorFinal = (input.indFinal ?? '1') === '1';
  const isNaoContribuinte = input.destinatario.indIEDest === '9';
  if (isInterestadual && isConsumidorFinal && isNaoContribuinte) {
    const ufDest = input.destinatario.endereco.uf;
    detItems.forEach((det, i) => {
      if (det.imposto.ICMS) {
        const icmsVals = extractICMSValues(det.imposto.ICMS);
        if (icmsVals.vBC.gt(0)) {
          const origem = input.itens[i]?.icms.origem ?? '0';
          const pICMSInter = getAliqInterestadual(input.ufEmitente, ufDest, origem);
          // Item primeiro: quem resolveu a alíquota pelo NCM na UF de destino
          // acertou para aquele produto. O valor da nota é o segundo melhor, e o
          // 18% é o último recurso — que a rota relata em `avisos`.
          const pICMSUFDest = input.itens[i]?.pICMSUFDest ?? input.pICMSUFDest ?? '18';
          const pFCPUFDest = input.itens[i]?.pFCPUFDest ?? input.pFCPUFDest;
          det.imposto.ICMSUFDest = buildICMSUFDest(icmsVals.vBC, pICMSUFDest, pICMSInter, pFCPUFDest);
        }
      }
    });
  }

  // Compute totals using Decimal.js
  let totVBC = new Decimal('0');
  let totVICMS = new Decimal('0');
  let totVICMSDeson = new Decimal('0');
  let totVProd = new Decimal('0');
  let totVPIS = new Decimal('0');
  let totVCOFINS = new Decimal('0');
  let totVFCP = new Decimal('0');
  let totVBCST = new Decimal('0');
  let totVST = new Decimal('0');
  let totVIPI = new Decimal('0');
  let totVFCPUFDest = new Decimal('0');
  let totVICMSUFDest = new Decimal('0');
  let totVICMSUFRemet = new Decimal('0');
  // Acessórios: o total tem de bater exatamente com a soma dos itens, senão a
  // SEFAZ rejeita por divergência de totalização.
  let totVDesc = new Decimal('0');
  let totVFrete = new Decimal('0');
  let totVSeg = new Decimal('0');
  let totVOutro = new Decimal('0');

  for (const det of detItems) {
    totVProd = totVProd.plus(new Decimal(det.prod.vProd));
    totVDesc = totVDesc.plus(new Decimal(det.prod.vDesc ?? '0'));
    totVFrete = totVFrete.plus(new Decimal(det.prod.vFrete ?? '0'));
    totVSeg = totVSeg.plus(new Decimal(det.prod.vSeg ?? '0'));
    totVOutro = totVOutro.plus(new Decimal(det.prod.vOutro ?? '0'));

    if (det.imposto.ICMS) {
      const icmsVals = extractICMSValues(det.imposto.ICMS);
      totVBC = totVBC.plus(icmsVals.vBC);
      totVICMS = totVICMS.plus(icmsVals.vICMS);
      totVICMSDeson = totVICMSDeson.plus(icmsVals.vICMSDeson);
      totVBCST = totVBCST.plus(icmsVals.vBCST);
      totVST = totVST.plus(icmsVals.vST);
    }

    if (det.imposto.ICMSUFDest) {
      totVFCPUFDest = totVFCPUFDest.plus(new Decimal(det.imposto.ICMSUFDest.vFCPUFDest ?? '0'));
      totVICMSUFDest = totVICMSUFDest.plus(new Decimal(det.imposto.ICMSUFDest.vICMSUFDest));
      totVICMSUFRemet = totVICMSUFRemet.plus(new Decimal(det.imposto.ICMSUFDest.vICMSUFRemet));
    }

    if (det.imposto.IPI) {
      totVIPI = totVIPI.plus(extractIPIValue(det.imposto.IPI));
    }

    if (det.imposto.PIS) {
      totVPIS = totVPIS.plus(extractPISValue(det.imposto.PIS));
    }

    if (det.imposto.COFINS) {
      totVCOFINS = totVCOFINS.plus(extractCOFINSValue(det.imposto.COFINS));
    }
  }

  // vNF = vProd + vST + vFrete + vSeg + vOutro + vII + vIPI - vDesc - vICMSDeson
  const vNF = totVProd
    .plus(totVST)
    .plus(totVFrete)
    .plus(totVSeg)
    .plus(totVOutro)
    .plus(totVIPI)
    .minus(totVDesc)
    .minus(totVICMSDeson);

  const hasDifal = totVICMSUFDest.gt(0) || totVFCPUFDest.gt(0);

  // Totais IBS/CBS — soma dos grupos UB dos itens. Precisa fechar exatamente com
  // os itens, senao a SEFAZ rejeita por divergencia de totalizacao.
  const zero = new Decimal(0);
  const totIbs = detItems.reduce((acc, det) => {
    const g = det.imposto.IBSCBS?.gIBSCBS;
    if (!g) return acc;
    return {
      vBC: acc.vBC.plus(g.vBC),
      vIBSUF: acc.vIBSUF.plus(g.gIBSUF.vIBSUF),
      vIBSMun: acc.vIBSMun.plus(g.gIBSMun.vIBSMun),
      vIBS: acc.vIBS.plus(g.vIBS),
      vCBS: acc.vCBS.plus(g.gCBS.vCBS),
    };
  }, { vBC: zero, vIBSUF: zero, vIBSMun: zero, vIBS: zero, vCBS: zero });

  const temIbsCbs = detItems.some(det => det.imposto.IBSCBS);

  /**
   * Valor aproximado dos tributos (Lei 12.741/2012).
   *
   * O DANFE tem um quadro "V. TOT. TRIB." que lê este campo. Como nada o
   * preenchia, ele saía impresso como R$ 0,00 — foi o que apareceu na
   * conferência de uma nota real.
   *
   * A lei pede o total aproximado de tributos federais, estaduais e
   * municipais. O cálculo rigoroso usa a tabela do IBPT, que varia por NCM e
   * por estado e não está neste sistema. O que se soma aqui são os tributos
   * efetivamente destacados na nota — ICMS, ST, IPI, PIS, COFINS, IBS e CBS.
   *
   * É uma aproximação por baixo: não inclui tributo embutido no preço que a
   * nota não destaca. Melhor do que zero, e coerente com o próprio documento;
   * quem precisar do número do IBPT tem que trazer a tabela.
   *
   * O valor vai TAMBÉM em cada item (det/imposto/vTotTrib): a SEFAZ valida que
   * o total fecha com a soma dos itens (cStat 685). Sem o campo por item, com
   * IBS/CBS destacado o total ficava > 0 e a soma dos itens 0 → rejeição. Por
   * isso o total aqui é a soma dos itens JÁ arredondados, e não o arredondamento
   * da soma — é o item arredondado que a SEFAZ soma do outro lado.
   */
  let totVTotTrib = new Decimal('0');
  for (const det of detItems) {
    let itemTrib = new Decimal('0');
    if (det.imposto.ICMS) {
      const v = extractICMSValues(det.imposto.ICMS);
      itemTrib = itemTrib.plus(v.vICMS).plus(v.vST);
    }
    if (det.imposto.IPI) itemTrib = itemTrib.plus(extractIPIValue(det.imposto.IPI));
    if (det.imposto.PIS) itemTrib = itemTrib.plus(extractPISValue(det.imposto.PIS));
    if (det.imposto.COFINS) itemTrib = itemTrib.plus(extractCOFINSValue(det.imposto.COFINS));
    const g = det.imposto.IBSCBS?.gIBSCBS;
    if (g) itemTrib = itemTrib.plus(new Decimal(g.vIBS)).plus(new Decimal(g.gCBS.vCBS));
    const itemRound = itemTrib.toDecimalPlaces(2);
    det.imposto.vTotTrib = itemRound.toFixed(2);
    totVTotTrib = totVTotTrib.plus(itemRound);
  }

  // Desconto maior que a nota nao se conserta por adivinhacao.
  //
  // Nota de R$ 150,00 com desconto de R$ 500,00 (dedo escorregou, ou o ERP
  // mandou o desconto em centavos) faz o rateio dar a cada item um desconto
  // maior que o proprio valor, e o vNF sai NEGATIVO. O schema recusa o sinal,
  // mas com um erro de facet que nao diz "seu desconto e maior que a nota".
  //
  // Pior que o negativo: desconto exatamente igual ao total gera vNF 0,00, que
  // passa no schema, passa na previa e e TRANSMITIDO — nota de valor zero,
  // autorizada. Por isso a conferencia e `>=` sobre o total com acessorios, e
  // nao so `>` sobre os produtos.
  const totalComAcessorios = totVProd.plus(totVFrete).plus(totVSeg).plus(totVOutro);
  if (totVDesc.gt(0) && totVDesc.gte(totalComAcessorios) && totalComAcessorios.gt(0)) {
    throw new ErroDeDados(
      `DESCONTO_MAIOR_QUE_A_NOTA: o desconto soma R$ ${totVDesc.toFixed(2)} e a nota vale `
      + `R$ ${totalComAcessorios.toFixed(2)} em produtos e acessorios. `
      + 'Desconto igual ou maior que o total costuma ser erro de unidade (valor em centavos) '
      + 'ou de digitacao — e adivinhar o valor certo emitiria uma nota que ninguem pediu.',
    );
  }

  const total: TotalNFe = {
    ICMSTot: {
      vBC: totVBC.toFixed(2),
      vICMS: totVICMS.toFixed(2),
      vICMSDeson: totVICMSDeson.toFixed(2),
      vFCPUFDest: hasDifal ? totVFCPUFDest.toFixed(2) : undefined,
      vICMSUFDest: hasDifal ? totVICMSUFDest.toFixed(2) : undefined,
      vICMSUFRemet: hasDifal ? totVICMSUFRemet.toFixed(2) : undefined,
      vFCP: totVFCP.toFixed(2),
      vBCST: totVBCST.toFixed(2),
      vST: totVST.toFixed(2),
      vFCPST: '0.00',
      vFCPSTRet: '0.00',
      vProd: totVProd.toFixed(2),
      vFrete: totVFrete.toFixed(2),
      vSeg: totVSeg.toFixed(2),
      vDesc: totVDesc.toFixed(2),
      vII: '0.00',
      vIPI: totVIPI.toFixed(2),
      vIPIDevol: '0.00',
      vPIS: totVPIS.toFixed(2),
      vCOFINS: totVCOFINS.toFixed(2),
      vOutro: totVOutro.toFixed(2),
      vNF: vNF.toFixed(2),
      // Alimenta o quadro "V. TOT. TRIB." do DANFE, que existe e vinha zerado.
      vTotTrib: totVTotTrib.toFixed(2),
    },
    IBSCBSTot: temIbsCbs ? {
      vBCIBSCBS: totIbs.vBC.toFixed(2),
      gIBS: {
        gIBSUF: { vDif: '0.00', vDevTrib: '0.00', vIBSUF: totIbs.vIBSUF.toFixed(2) },
        gIBSMun: { vDif: '0.00', vDevTrib: '0.00', vIBSMun: totIbs.vIBSMun.toFixed(2) },
        vIBS: totIbs.vIBS.toFixed(2),
        vCredPres: '0.00',
        vCredPresCondSus: '0.00',
      },
      gCBS: {
        vDif: '0.00', vDevTrib: '0.00', vCBS: totIbs.vCBS.toFixed(2),
        vCredPres: '0.00', vCredPresCondSus: '0.00',
      },
    } : undefined,
  };

  // IDE
  const ide: IdentificacaoNFe = {
    cUF,
    cNF,
    natOp: limitarTexto(input.naturezaOperacao, 'natOp')!,
    mod: input.mod || '55',
    serie: input.serie,
    nNF: input.numero,
    dhEmi: input.dataEmissao,
    tpNF: input.tipoOperacao,
    idDest: input.mod === '65' ? '1' : input.destino,
    cMunFG: input.municipioFG,
    // Na devolução a referência vai por item (DFeReferenciado); informar nos
    // dois níveis é rejeitado com cStat 1010.
    NFref: ehDevolucao ? undefined : normalizarNotasReferenciadas(input.notasReferenciadas),
    tpImp: input.mod === '65' ? '4' : '1',
    tpEmis: TipoEmissao.NORMAL,
    cDV: '0', // placeholder — computed externally via NFeKeyGenerator
    tpAmb: input.ambiente as TipoAmbiente,
    finNFe: input.finalidade as FinalidadeNFe,
    indFinal: input.indFinal ?? '1',
    indPres: input.presenca as IndicadorPresenca,
    procEmi: '0',
    verProc: '1.0.0',
  };

  // Documento invalido custava uma transmissao inteira: a previa ficava verde e
  // a SEFAZ recusava com 207 (CNPJ) ou 237 (CPF), que e o momento mais caro de
  // descobrir que alguem trocou um digito. Pontuacao vira digito em silencio;
  // digito que nao fecha e recusado, porque adivinhar mudaria o destinatario.
  for (const [valor, tipo, dono] of [
    [input.emitente.cnpj, 'cnpj', 'emitente'],
    [input.destinatario.cnpj, 'cnpj', 'destinatário'],
    [input.destinatario.cpf, 'cpf', 'destinatário'],
  ] as Array<[string | undefined, 'cpf' | 'cnpj', string]>) {
    const erro = erroDeDocumento(valor, tipo, dono);
    if (erro) throw new ErroDeDados(erro);
  }

  for (const [endereco, dono] of [
    [input.emitente.endereco, 'emitente'],
    [input.destinatario.endereco, 'destinatário'],
  ] as Array<[FiscalContextEndereco | undefined, string]>) {
    const erro = erroDeCep(endereco?.cep, endereco?.uf);
    if (erro) throw new ErroDeDados(`${erro.split(':')[0]}: (${dono}) ${erro.split(': ').slice(1).join(': ')}`);
  }

  // Emitente
  const emit: Emitente = {
    CNPJ: somenteDigitos(input.emitente.cnpj) || undefined,
    xNome: limitarTexto(input.emitente.razaoSocial, 'xNome')!,
    xFant: limitarTexto(input.emitente.fantasia, 'xFant'),
    enderEmit: toEndereco(input.emitente.endereco),
    IE: input.emitente.ie,
    CRT: input.emitente.crt,
  };

  // Destinatario
  const dest: Destinatario = {
    CNPJ: somenteDigitos(input.destinatario.cnpj) || undefined,
    CPF: somenteDigitos(input.destinatario.cpf) || undefined,
    xNome: limitarTexto(input.destinatario.razaoSocial, 'xNome')!,
    enderDest: toEndereco(input.destinatario.endereco),
    indIEDest: input.destinatario.indIEDest,
    IE: input.destinatario.ie,
    email: input.destinatario.email,
  };

  // Transporte
  const transp: Transporte = {
    modFrete: input.modFrete ?? '9', // 9 = Sem frete
  };

  // Pagamento — conferido contra o vNF calculado.
  //
  // O ERP manda o valor do PEDIDO (antes de frete, IPI, ST) ou o operador digita
  // errado, e o motor copiava para vPag sem nunca comparar com o total que ele
  // mesmo calculou. O schema so olha formato, a previa dava verde, e a SEFAZ
  // recusava com 610 "Total do Pagamento difere do Total da Nota". Na NFC-e a
  // regra e obrigatoria e a rota nem tem previa.
  //
  // Uma forma so e sem troco: CORRIGE. O ERP quis dizer "pagou tudo", e recusar
  // por causa do frete que ele nao somou seria birra.
  // Varias formas: RECUSA dizendo os dois numeros — ali a diferenca pode ser um
  // pagamento faltando, e escolher em qual forma somar mudaria a nota.
  const formasPagas = input.pagamento.formas.map(f => ({
    tPag: f.tipo,
    vPag: new Decimal(f.valor || '0'),
  }));
  const troco = input.pagamento.troco ? new Decimal(input.pagamento.troco) : new Decimal(0);
  const somaPagamentos = formasPagas.reduce((a, f) => a.plus(f.vPag), new Decimal(0));
  const liquido = somaPagamentos.minus(troco);

  // tPag 90 e "sem pagamento" — valor ali e contradicao, e a SEFAZ recusa.
  const semPagamentoComValor = formasPagas.find(f => f.tPag === '90' && f.vPag.gt(0));
  if (semPagamentoComValor) {
    throw new ErroDeDados(
      `PAGAMENTO_INCOERENTE: a forma de pagamento 90 significa "sem pagamento", mas veio com `
      + `R$ ${semPagamentoComValor.vPag.toFixed(2)}. Use outra forma, ou deixe o valor em 0,00.`,
    );
  }

  // Nota SEM pagamento tem vPag 0,00 e vNF cheio — e isso e correto, nao
  // divergencia. E o caso de remessa, bonificacao, comodato, brinde e nota de
  // entrada: mercadoria circula, dinheiro nao. Comparar aqui faria a correcao
  // automatica escrever o valor da nota num campo que precisa ficar zerado.
  const soSemPagamento = formasPagas.length > 0 && formasPagas.every(f => f.tPag === '90');

  if (!soSemPagamento && !liquido.equals(vNF) && formasPagas.length > 0) {
    const diferenca = vNF.minus(liquido);
    if (formasPagas.length === 1 && troco.isZero()) {
      formasPagas[0]!.vPag = vNF;
    } else {
      throw new ErroDeDados(
        `PAGAMENTO_DIVERGENTE: as formas de pagamento somam R$ ${liquido.toFixed(2)}`
        + `${troco.gt(0) ? ` (ja descontado o troco de R$ ${troco.toFixed(2)})` : ''}`
        + ` e a nota vale R$ ${vNF.toFixed(2)} — diferenca de R$ ${diferenca.abs().toFixed(2)}. `
        + 'Com mais de uma forma de pagamento nao da para escolher em qual somar sem mudar a nota. '
        + 'A SEFAZ recusa isto com cStat 610.',
      );
    }
  }

  const pag: Pagamento = {
    detPag: formasPagas.map((f) => ({
      tPag: f.tPag,
      vPag: f.vPag.toFixed(2),
    })),
    vTroco: input.pagamento.troco
      ? new Decimal(input.pagamento.troco).toFixed(2)
      : undefined,
  };

  // Informacoes adicionais
  /**
   * Demonstrativo do IBS/CBS nas informações complementares.
   *
   * O DANFE não tem quadro para IBS/CBS: a `sped-da`, que gera o PDF, é
   * anterior à Reforma e não conhece esses tributos — a nota sai autorizada com
   * os valores no XML e nada impresso.
   *
   * As informações complementares a biblioteca **imprime** (como "Inf.
   * Contribuinte"), então o demonstrativo sai no papel hoje, sem depender de
   * atualização de terceiro.
   *
   * Não desenhei um quadro próprio na biblioteca de propósito: o layout do
   * DANFE é regulamentado e o quadro oficial da Reforma ainda está sendo
   * definido. Inventar um agora deixaria o documento diferente do que todos
   * imprimem, e criaria conflito quando a versão oficial chegar.
   */
  const demonstrativoIbsCbs = temIbsCbs
    ? `Reforma Tributaria (LC 214/2025) - Base IBS/CBS R$ ${formatarReal(totIbs.vBC)}`
      + ` | IBS R$ ${formatarReal(totIbs.vIBS)}${aliquotaEfetiva(totIbs.vIBS, totIbs.vBC)}`
      + ` | CBS R$ ${formatarReal(totIbs.vCBS)}${aliquotaEfetiva(totIbs.vCBS, totIbs.vBC)}`
      + ` | Total IBS+CBS R$ ${formatarReal(totIbs.vIBS.plus(totIbs.vCBS))}`
      + ' - destaque obrigatorio; em 2026 nao ha recolhimento para quem cumpre a obrigacao acessoria.'
    : '';

  // infCpl vai ate 5000 caracteres (rejeicao 215 acima disso). Quando os dois
  // textos nao cabem, corta o do usuario e nao o demonstrativo: o destaque da
  // Reforma e obrigatorio, o texto livre nao.
  const SEPARADOR = ' | ';
  const espacoParaUsuario = LIMITE_INF_CPL
    - (demonstrativoIbsCbs ? demonstrativoIbsCbs.length + SEPARADOR.length : 0);
  const complementarInformado = (input.informacoesAdicionais?.complementar?.trim() || '')
    .slice(0, Math.max(0, espacoParaUsuario));
  const complementarFinal = [complementarInformado, demonstrativoIbsCbs]
    .filter(Boolean).join(SEPARADOR) || undefined;

  let infAdic: InformacoesAdicionais | undefined;
  if (input.informacoesAdicionais || complementarFinal) {
    infAdic = {
      infAdFisco: input.informacoesAdicionais?.fisco,
      infCpl: complementarFinal,
    };
  }

  const nfe: NFe = {
    ide,
    emit,
    dest,
    det: detItems,
    total,
    transp,
    pag,
    infAdic,
  };

  return nfe;
}
