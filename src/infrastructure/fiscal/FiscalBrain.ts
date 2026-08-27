import axios, { AxiosInstance } from 'axios';

/**
 * FiscalBrain — cliente do "cérebro fiscal" (base de NCM/ICMS/ST/CEST/IPI).
 *
 * Consulta uma base fiscal externa (Supabase/PostgREST) SOMENTE do lado do servidor;
 * a chave nunca chega ao navegador. Usada para:
 *  - buscar NCM por descrição (autocomplete no cadastro de produto);
 *  - sugerir a classificação fiscal (CST/CSOSN, CFOP, alíquotas, CEST, MVA-ST) por NCM+UF+regime.
 *
 * Config por env: FISCAL_API_URL, FISCAL_API_KEY. Se ausente, `disponivel` = false
 * e as rotas devolvem vazio (o operador ainda pode digitar tudo à mão).
 */

const FISCAL_URL = process.env['FISCAL_API_URL'] || '';
const FISCAL_KEY = process.env['FISCAL_API_KEY'] || '';

export interface NcmResultado {
  codigo: string;      // 8 dígitos, sem pontos
  descricao: string;
}

export interface ClassificacaoFiscal {
  ncm: string;
  descricao: string;
  unidade?: string;
  origem: string;          // 0 = nacional (default)
  cstCsosn: string;        // CSOSN (Simples) ou CST (Normal)
  cfop: string;
  aliqIcms?: string;
  redBcIcms?: string;
  cstIpi: string;
  aliqIpi?: string;
  cest?: string;
  mva?: string;
  aliqIcmsSt?: string;
  cstPis: string;
  cstCofins: string;
  cbenef?: string;
  baseLegal?: string;
  temST: boolean;
  fonte: 'classificacao_fiscal' | 'composto';
}

// ---------------------------------------------------------------------------
// CFOP dinâmico — determinado por tipo de operação + interno/interestadual
// ---------------------------------------------------------------------------
export type TipoOperacaoFiscal =
  | 'venda_producao'
  | 'venda_revenda'
  | 'venda_st_retido'
  | 'devolucao'
  | 'remessa_demonstracao'
  | 'remessa_conserto'
  | 'transferencia'
  | 'bonificacao'
  | 'industrializacao';

interface CfopSet { saidaInterna: string; saidaInter: string; entradaInterna: string; entradaInter: string }

const CFOP_MAP: Record<TipoOperacaoFiscal, CfopSet> = {
  venda_producao:       { saidaInterna: '5101', saidaInter: '6101', entradaInterna: '1101', entradaInter: '2101' },
  venda_revenda:        { saidaInterna: '5102', saidaInter: '6102', entradaInterna: '1102', entradaInter: '2102' },
  venda_st_retido:      { saidaInterna: '5405', saidaInter: '6404', entradaInterna: '1403', entradaInter: '2403' },
  devolucao:            { saidaInterna: '5202', saidaInter: '6202', entradaInterna: '1202', entradaInter: '2202' },
  remessa_demonstracao: { saidaInterna: '5912', saidaInter: '6912', entradaInterna: '1913', entradaInter: '2913' },
  remessa_conserto:     { saidaInterna: '5915', saidaInter: '6915', entradaInterna: '1916', entradaInter: '2916' },
  transferencia:        { saidaInterna: '5152', saidaInter: '6152', entradaInterna: '1152', entradaInter: '2152' },
  bonificacao:          { saidaInterna: '5910', saidaInter: '6910', entradaInterna: '1910', entradaInter: '2910' },
  industrializacao:     { saidaInterna: '5101', saidaInter: '6101', entradaInterna: '1101', entradaInter: '2101' },
};

export const TIPOS_OPERACAO: { valor: TipoOperacaoFiscal; label: string }[] = [
  { valor: 'venda_revenda',        label: 'Venda / Revenda (comercio)' },
  { valor: 'venda_producao',       label: 'Venda producao propria (industria)' },
  { valor: 'venda_st_retido',      label: 'Venda c/ ST ja retido (CFOP 5405)' },
  { valor: 'devolucao',            label: 'Devolucao' },
  { valor: 'remessa_demonstracao', label: 'Remessa p/ demonstracao' },
  { valor: 'remessa_conserto',     label: 'Remessa p/ conserto/reparo' },
  { valor: 'transferencia',        label: 'Transferencia entre filiais' },
  { valor: 'bonificacao',          label: 'Bonificacao / amostra gratis' },
  { valor: 'industrializacao',     label: 'Industrializacao por encomenda' },
];

export function resolverCfop(
  operacao: TipoOperacaoFiscal,
  opts: { entrada?: boolean; interestadual?: boolean },
): string {
  const set = CFOP_MAP[operacao] || CFOP_MAP.venda_revenda;
  if (opts.entrada) return opts.interestadual ? set.entradaInter : set.entradaInterna;
  return opts.interestadual ? set.saidaInter : set.saidaInterna;
}

/** NCM 8 dígitos -> formato pontuado XXXX.XX.XX (usado nas tabelas de regras). */
function pontuar(ncm: string): string {
  const d = ncm.replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}` : ncm;
}

/** Regex POSIX tolerante a acentos p/ busca imatch (~*) no PostgREST. */
function regexAcento(q: string): string {
  const map: Record<string, string> = { a: 'aáàâã', e: 'eéèê', i: 'iíì', o: 'oóòôõ', u: 'uúùû', c: 'cç' };
  return q
    .trim()
    .toLowerCase()
    .split('')
    .map((ch) => (map[ch] ? `[${map[ch]}]` : /[a-z0-9]/.test(ch) ? ch : ''))
    .join('');
}

export class FiscalBrain {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: FISCAL_URL.endsWith('/') ? FISCAL_URL : FISCAL_URL + '/',
      timeout: 20000,
      headers: FISCAL_KEY ? { apikey: FISCAL_KEY, Authorization: `Bearer ${FISCAL_KEY}` } : {},
    });
  }

  get disponivel(): boolean {
    return Boolean(FISCAL_URL && FISCAL_KEY);
  }

  /** Busca NCMs por descrição (prefixo das palavras-chave, tolerante a acento). */
  async buscarNcm(q: string, limit = 12): Promise<NcmResultado[]> {
    if (!this.disponivel || !q || q.trim().length < 2) return [];
    const primeira = q.trim().split(/\s+/)[0];
    const rgx = '^' + regexAcento(primeira);
    if (rgx.length < 3) return [];
    try {
      const kws = await this.http.get('ncm_palavras_chave', {
        params: { palavra: `imatch.${rgx}`, select: 'ncm_id', limit: 80 },
      });
      const ids = [...new Set((kws.data as any[]).map((k) => k.ncm_id))].slice(0, limit * 3);
      if (!ids.length) return [];
      const ncms = await this.http.get('ncm', {
        params: { id: `in.(${ids.join(',')})`, select: 'codigo,descricao_simplificada,descricao', limit: limit * 3 },
      });
      const seen = new Set<string>();
      const out: NcmResultado[] = [];
      for (const r of ncms.data as any[]) {
        const c = String(r.codigo || '').replace(/\D/g, '');
        if (c.length === 8 && !seen.has(c)) {
          seen.add(c);
          out.push({ codigo: c, descricao: r.descricao_simplificada || r.descricao || '' });
          if (out.length >= limit) break;
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Sugere a classificação fiscal completa para um NCM + UF + regime. */
  async classificar(ncm8: string, uf: string, regime: 'simples' | 'normal'): Promise<ClassificacaoFiscal | null> {
    if (!this.disponivel) return null;
    const ncmD = pontuar(ncm8);

    // 1) Tabela curada (traz tudo, inclusive base legal e cBenef)
    try {
      const r = await this.http.get('classificacao_fiscal', { params: { ncm: `eq.${ncmD}`, uf: `eq.${uf}`, limit: 5 } });
      const rows = r.data as any[];
      if (rows && rows.length) {
        const row = rows[0];
        const temST = Number(row.aliquota_icms_st) > 0 || Boolean(row.cest) || Number(row.mva) > 0;
        return {
          ncm: ncm8,
          descricao: row.descricao || '',
          origem: '0',
          cstCsosn: regime === 'simples' ? (temST ? '500' : '102') : (row.cst_icms || (temST ? '10' : '00')),
          cfop: row.cfop_saida || '5102',
          aliqIcms: row.aliquota_icms != null ? String(row.aliquota_icms) : undefined,
          redBcIcms: Number(row.red_bc_icms) > 0 ? String(row.red_bc_icms) : undefined,
          cstIpi: row.cst_ipi || '53',
          aliqIpi: Number(row.aliquota_ipi) > 0 ? String(row.aliquota_ipi) : undefined,
          cest: row.cest || undefined,
          mva: Number(row.mva) > 0 ? String(row.mva) : undefined,
          aliqIcmsSt: Number(row.aliquota_icms_st) > 0 ? String(row.aliquota_icms_st) : undefined,
          cstPis: '99',
          cstCofins: '99',
          cbenef: row.cbenef || undefined,
          baseLegal: row.base_legal_icms || undefined,
          temST,
          fonte: 'classificacao_fiscal',
        };
      }
    } catch { /* cai no composto */ }

    // 2) Composição a partir das tabelas granulares
    try {
      const [ncmRows, stRows, cestRows, icmsUfRows] = await Promise.all([
        this.http.get('ncm', { params: { codigo_sem_pontos: `eq.${ncm8}`, select: 'descricao_simplificada,unidade_medida,aliquota_ipi', limit: 3 } }).then((r) => r.data as any[]).catch(() => []),
        this.http.get('icms_st_mva', { params: { ncm: `eq.${ncmD}`, uf_destino: `eq.${uf}`, select: 'mva_ajustado,aliquota_st,cest', limit: 1 } }).then((r) => r.data as any[]).catch(() => []),
        this.http.get('cest_ncm_oficial', { params: { ncm_sh: `eq.${ncmD}`, select: 'cest', limit: 1 } }).then((r) => r.data as any[]).catch(() => []),
        this.http.get('icms_uf', { params: { uf: `eq.${uf}`, select: 'aliquota_interna', limit: 1 } }).then((r) => r.data as any[]).catch(() => []),
      ]);
      const ncmRow = ncmRows.find((r) => r.descricao_simplificada) || ncmRows[0] || {};
      const st = stRows[0];
      const cest = (st && st.cest) || (cestRows[0] && cestRows[0].cest) || undefined;
      const temST = Boolean(st || cest);
      const aliqInterna = icmsUfRows[0] ? String(icmsUfRows[0].aliquota_interna) : '18';
      const ipiRow = ncmRows.find((r) => r.aliquota_ipi != null);
      return {
        ncm: ncm8,
        descricao: ncmRow.descricao_simplificada || '',
        unidade: ncmRow.unidade_medida || 'UN',
        origem: '0',
        cstCsosn: regime === 'simples' ? (temST ? '500' : '102') : (temST ? '10' : '00'),
        cfop: '5102',
        aliqIcms: regime === 'normal' ? aliqInterna : undefined,
        cstIpi: '53',
        aliqIpi: ipiRow && Number(ipiRow.aliquota_ipi) > 0 ? String(ipiRow.aliquota_ipi) : undefined,
        cest,
        mva: st && st.mva_ajustado ? String(st.mva_ajustado) : undefined,
        aliqIcmsSt: st && st.aliquota_st ? String(st.aliquota_st) : undefined,
        cstPis: '99',
        cstCofins: '99',
        temST,
        fonte: 'composto',
      };
    } catch {
      return null;
    }
  }
}
