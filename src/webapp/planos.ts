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
  /** Uma frase que diz para quem o plano e. Aparece na tela do admin. */
  perfil: string;
  /**
   * Emissoes por mes DE CADA servico contratado. `0` = sem limite.
   *
   * Por servico, e nao no total: um cliente que emite NF-e e NFS-e tem duas
   * cotas separadas, e estourar uma nao para a outra. Com um teto unico, quem
   * vende produto de manha ficava sem emitir a nota de servico da tarde — e a
   * mensagem falava de "cota do plano", sem dizer qual documento acabou.
   */
  limitePorServico: number;
  requestsPerMinute: number;
  /** `0` = sem limite. */
  requestsPerDay: number;
  /** Quantos CNPJs o cliente pode emitir por. `0` = sem limite. */
  empresas: number;
  webhooks: boolean;
  cor: string;
}

/**
 * Tres faixas, so por VOLUME.
 *
 * O plano nao decide mais QUAIS documentos o cliente emite — isso e o que ele
 * contratou, cadastrado em Servicos. Antes as duas coisas viviam no mesmo
 * lugar: "PRO = NF-e ou NFS-e" misturava um teto de volume com uma escolha de
 * produto, e mudar a faixa de preco mexia no que o cliente podia emitir.
 *
 * Preco nao entra aqui, e nem na tela: negocia-se caso a caso, e um numero
 * cravado no codigo envelhece na primeira excecao que voce abre.
 */
export const PLANOS: Plano[] = [
  {
    id: 'beta',
    nome: 'BETA',
    perfil: 'Comecando. Volume baixo, para conhecer o sistema emitindo de verdade.',
    limitePorServico: 25,
    requestsPerMinute: 60,
    requestsPerDay: 5_000,
    empresas: 1,
    webhooks: false,
    cor: '#0ea5e9',
  },
  {
    id: 'pro',
    nome: 'PRO',
    perfil: 'Operacao rodando. Volume mensal previsivel em cada documento.',
    limitePorServico: 50,
    requestsPerMinute: 120,
    requestsPerDay: 20_000,
    empresas: 3,
    webhooks: true,
    cor: '#6366f1',
  },
  {
    id: 'max',
    nome: 'MAX',
    perfil: 'Sem teto. Balcao, volume alto ou varias empresas.',
    limitePorServico: 0,
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
  // Os gratuitos e de entrada viram BETA — a faixa de quem esta comecando.
  free: 'beta',
  gratuito: 'beta',
  starter: 'beta',
  basico: 'beta',
  // `premium` era o sem-teto da nomenclatura antiga, e e o unico que os
  // clientes reais tinham. Vira MAX, que e o mesmo lugar com outro nome —
  // rebaixa-los seria cortar emissao de quem ja pagou pelo ilimitado.
  premium: 'max',
  enterprise: 'max',
  ilimitado: 'max',
  business: 'max',
  profissional: 'max',
};

/** Nunca devolve indefinido: plano desconhecido cai no mais restrito. */
export function planoDe(id: string | undefined | null): Plano {
  const chave = String(id ?? '').trim().toLowerCase();
  const direto = PLANOS.find(p => p.id === chave);
  if (direto) return direto;
  const equivalente = EQUIVALENTES[chave];
  return PLANOS.find(p => p.id === equivalente) ?? PLANOS[0]!;
}

/**
 * O plano permite emitir este documento?
 *
 * SEMPRE. O plano passou a ser so volume — quais documentos o cliente emite e o
 * que ele CONTRATOU, cadastrado em Servicos, e e la que a permissao e checada.
 *
 * A funcao continua existindo, e devolvendo `true`, porque ela e chamada de
 * varios pontos: troca-la por nada exigiria mexer nos chamadores para provar
 * uma regra que agora nao existe. Quando o ultimo chamador sair, ela sai junto.
 */
export function planoPermite(_id: string | undefined | null, _doc: Documento): boolean {
  return true;
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
  // Nao ha mais divergencia possivel: o plano nao promete documento nenhum,
  // so volume. O que o cliente emite e exatamente o que ele contratou.
  //
  // A funcao devolve `null` em vez de sumir porque a tela do cliente ainda a
  // consulta para desenhar o aviso — e `null` ali significa "esta tudo certo",
  // que passou a ser sempre verdade.
  void planoId; void servicosAtivos;
  return null;
}
