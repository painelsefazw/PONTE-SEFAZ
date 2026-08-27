/**
 * Os planos, em um lugar só.
 *
 * Antes havia duas listas que se contradiziam: `PLANOS` no billing (free,
 * starter, pro) e `PLAN_LIMITS` no rate limiter (free, starter, business, pro,
 * enterprise). Um cliente no plano `business` — o caso real da Aliança — não
 * existia na primeira, caía no fallback `PLANOS[0]` e recebia o limite do
 * gratuito: 10 notas por mês. Ele emitia normalmente até a décima e então parava,
 * com "Limite de uso atingido", sem ninguém entender por quê.
 *
 * A divisão é por PERFIL DE CLIENTE, não por faixa de preço — preço se negocia
 * caso a caso e não pertence ao código.
 */

export type Documento = 'nfe' | 'nfce' | 'nfse';

export interface Plano {
  id: string;
  nome: string;
  /** Uma frase que diz para quem o plano é. Aparece na tela do admin. */
  perfil: string;
  /** O que este plano permite emitir. */
  documentos: Documento[];
  /**
   * Se `escolheUm`, o cliente contrata UM dos documentos da lista, não todos.
   * É o que separa "prestador de serviço" de "quem vende produto e serviço".
   */
  escolheUm: boolean;
  /** Notas por mês em produção. `0` = sem limite. */
  limiteNotas: number;
  requestsPerMinute: number;
  /** `0` = sem limite. */
  requestsPerDay: number;
  /** Quantos CNPJs o cliente pode emitir por. `0` = sem limite. */
  empresas: number;
  webhooks: boolean;
  cor: string;
}

/**
 * Três faixas, na ordem em que um cliente cresce.
 *
 * A NFC-e mora só no PREMIUM por VOLUME, não por sofisticação: é o cupom do
 * balcão, e um restaurante emite 200 a 400 por dia. Um plano dimensionado para
 * NF-e — dezenas por dia — não comporta isso, e liberar sem dimensionar
 * transforma um cliente em prejuízo no primeiro mês.
 */
export const PLANOS: Plano[] = [
  {
    id: 'pro',
    nome: 'PRO',
    perfil: 'Emite um tipo de documento, volume baixo. Prestador de servico ou comercio pequeno.',
    documentos: ['nfe', 'nfse'],
    escolheUm: true,
    limiteNotas: 300,
    requestsPerMinute: 60,
    requestsPerDay: 5_000,
    empresas: 1,
    webhooks: false,
    cor: '#0ea5e9',
  },
  {
    id: 'max',
    nome: 'MAX',
    perfil: 'Vende produto E presta servico. NF-e e NFS-e no mesmo sistema.',
    documentos: ['nfe', 'nfse'],
    escolheUm: false,
    limiteNotas: 1_500,
    requestsPerMinute: 120,
    requestsPerDay: 20_000,
    empresas: 3,
    webhooks: true,
    cor: '#6366f1',
  },
  {
    id: 'premium',
    nome: 'PREMIUM',
    perfil: 'Tem balcao (NFC-e), volume alto ou varias empresas. Varejo, restaurante, rede.',
    documentos: ['nfe', 'nfce', 'nfse'],
    escolheUm: false,
    limiteNotas: 0,
    requestsPerMinute: 300,
    requestsPerDay: 0,
    empresas: 0,
    webhooks: true,
    cor: '#a855f7',
  },
];

/**
 * Planos antigos continuam funcionando.
 *
 * Trocar os identificadores sem isto faria todo cliente já cadastrado cair no
 * fallback — exatamente o defeito que esta consolidação existe para corrigir.
 * `business` vira MAX porque é onde a Aliança estava na prática: NF-e e NFS-e.
 */
const EQUIVALENTES: Record<string, string> = {
  free: 'pro',
  gratuito: 'pro',
  starter: 'pro',
  basico: 'pro',
  business: 'max',
  profissional: 'max',
  enterprise: 'premium',
  ilimitado: 'premium',
};

/** Nunca devolve indefinido: plano desconhecido cai no mais restrito. */
export function planoDe(id: string | undefined | null): Plano {
  const chave = String(id ?? '').trim().toLowerCase();
  const direto = PLANOS.find(p => p.id === chave);
  if (direto) return direto;
  const equivalente = EQUIVALENTES[chave];
  return PLANOS.find(p => p.id === equivalente) ?? PLANOS[0]!;
}

/** O plano permite emitir este documento? */
export function planoPermite(id: string | undefined | null, doc: Documento): boolean {
  return planoDe(id).documentos.includes(doc);
}

/**
 * O que o plano promete e o que o cliente tem ativado batem?
 *
 * O caso real: a LIDERA estava no PREMIUM — descrito na própria tela como
 * "tudo com NFC-e" — com apenas NF-e e NFS-e ativados. Como as abas da
 * plataforma nascem da lista de serviços ATIVADOS, ela ia receber um sistema sem
 * o balcão, pagando por ele. Ninguém percebe isso olhando: o selo do plano diz
 * uma coisa e as etiquetas de serviço dizem outra, e as duas estão a dez linhas
 * de distância na mesma tela.
 *
 * `faltam` são documentos do plano que ninguém ativou — o cliente paga e não
 * recebe. `sobram` são documentos ativados que o plano não cobre — o cliente
 * recebe e não paga.
 *
 * Planos com `escolheUm` não entram em `faltam`: ali contratar UM dos documentos
 * é o comportamento correto, e apontar o outro como falta seria alarme falso em
 * todo cliente PRO.
 *
 * CT-e e MDF-e ficam de fora dos dois lados de propósito: nenhum plano os lista,
 * então compará-los acusaria "sobra" em todo cliente que os tivesse.
 */
export function divergenciaDePlano(
  planoId: string | undefined | null,
  servicosAtivos: readonly string[],
): { faltam: Documento[]; sobram: Documento[] } | null {
  const plano = planoDe(planoId);
  const conhecidos: Documento[] = ['nfe', 'nfce', 'nfse'];
  const ativos = new Set(servicosAtivos.map(s => String(s).trim().toLowerCase()));

  const faltam = plano.escolheUm ? [] : plano.documentos.filter(d => !ativos.has(d));
  const sobram = conhecidos.filter(d => ativos.has(d) && !plano.documentos.includes(d));

  return faltam.length || sobram.length ? { faltam, sobram } : null;
}
