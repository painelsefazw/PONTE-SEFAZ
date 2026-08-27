/**
 * Descobrir em qual pooler do Supabase um projeto vive.
 *
 * O host tem um numero de frota no nome — `aws-0-us-west-2` e
 * `aws-1-us-west-2` sao balanceadores DIFERENTES, e um projeto atende em um so.
 * O painel do Supabase mostra o certo, mas essa tela quebra com traducao
 * automatica do navegador e o valor acaba sendo copiado errado.
 *
 * Errar aqui produz `password authentication failed` — que parece senha errada.
 * Numa instalacao real isso levou a dois resets de senha antes de alguem
 * desconfiar do host. E a confusao e simetrica: neste mesmo projeto eu supus
 * `aws-1` e estava errado; so a medicao resolveu.
 *
 * A medicao NAO precisa da senha de verdade: basta tentar conectar com uma
 * senha qualquer e ler qual recusa veio.
 */

/** Regioes onde o Supabase hospeda projetos. */
export const REGIOES = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1',
  'sa-east-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1',
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
];

/** As frotas ja vistas em uso. Novo numero entra aqui. */
export const FROTAS = [0, 1];

export type Veredito =
  | 'tenant-aqui'
  | 'tenant-nao-esta-aqui'
  | 'host-nao-existe'
  | 'inconclusivo';

/**
 * O que a recusa do pooler significa.
 *
 * Senha recusada e a resposta BOA: para recusar a senha o Supavisor precisou
 * achar o tenant, o que prova que o projeto atende naquele host.
 */
export function classificarSonda(mensagem: string): Veredito {
  const m = String(mensagem ?? '').toLowerCase();
  if (!m) return 'inconclusivo';

  // O Supavisor escreve isso de mais de um jeito, e um deles vem PREFIXADO com
  // `(ENOTFOUND)` — apesar de o host ter resolvido normalmente. Casar so
  // "tenant or user not found" deixava passar `tenant/user postgres.xxx not
  // found`, que e a forma que este projeto viu na pratica, e ela caia no ramo
  // de DNS: mandaria procurar erro de digitacao num host que existe.
  if (/tenant[\s\S]{0,80}not found/.test(m)) return 'tenant-nao-esta-aqui';
  if (/password authentication failed|authentication failed/.test(m)) return 'tenant-aqui';
  if (/enotfound|eai_again/.test(m)) return 'host-nao-existe';
  return 'inconclusivo';
}

/** Monta o host, e recusa regiao que nao esta na lista. */
export function hostDoPooler(frota: number, regiao: string): string {
  if (!REGIOES.includes(regiao)) {
    throw new Error(`Regiao desconhecida: "${regiao}". Use uma das: ${REGIOES.join(', ')}`);
  }
  if (!FROTAS.includes(frota)) {
    throw new Error(`Frota desconhecida: ${frota}.`);
  }
  return `aws-${frota}-${regiao}.pooler.supabase.com`;
}

/** A referencia do projeto: o pedaco do meio da URL do painel do Supabase. */
export function referenciaValida(ref: string): boolean {
  return /^[a-z]{16,32}$/.test(String(ref ?? '').trim());
}

export interface ResultadoDaBusca {
  host: string | null;
  tentativas: { host: string; veredito: Veredito }[];
  explicacao: string;
}

/**
 * Sonda as frotas de uma regiao e diz qual host conhece o projeto.
 *
 * `sondar` e injetado para o teste nao depender de rede: ele recebe host e
 * referencia e devolve a mensagem de erro crua do driver.
 */
export async function descobrirHostDoPooler(
  opts: { referencia: string; regiao: string },
  sondar: (host: string, referencia: string) => Promise<string>,
): Promise<ResultadoDaBusca> {
  if (!referenciaValida(opts.referencia)) {
    throw new Error(
      `Referencia invalida: "${opts.referencia}". E o pedaco do meio da URL do painel `
      + 'do Supabase, so letras minusculas.',
    );
  }

  const tentativas: { host: string; veredito: Veredito }[] = [];
  for (const frota of FROTAS) {
    const host = hostDoPooler(frota, opts.regiao);
    const veredito = classificarSonda(await sondar(host, opts.referencia));
    tentativas.push({ host, veredito });
    if (veredito === 'tenant-aqui') {
      return {
        host,
        tentativas,
        explicacao: `O projeto atende em ${host}. A senha foi recusada de proposito — `
          + 'e essa recusa que prova que o tenant existe ali.',
      };
    }
  }

  // Nenhuma frota reconheceu. Nao inventar: dizer o que foi medido.
  const todasNegaram = tentativas.every(t => t.veredito === 'tenant-nao-esta-aqui');
  return {
    host: null,
    tentativas,
    explicacao: todasNegaram
      ? `Nenhuma frota de ${opts.regiao} conhece o projeto ${opts.referencia}. `
        + 'Provavelmente a regiao esta errada — confira no painel do Supabase.'
      : 'Nao deu para decidir: alguma sonda nao respondeu ou o host nao existe. '
        + 'Confira a regiao e tente de novo.',
  };
}

/**
 * A sonda de verdade: tenta conectar com uma senha propositalmente errada.
 *
 * Nao existe versao "sem senha" deste teste — o Supavisor so revela se conhece
 * o tenant depois de tentar autenticar. Por isso a senha aqui e uma constante
 * inventada: ela nunca vai autenticar em lugar nenhum, e a mensagem de recusa
 * e a unica coisa que interessa.
 */
export async function sondarPoolerDeVerdade(host: string, referencia: string): Promise<string> {
  const { Client } = await import('pg');
  const cliente = new Client({
    host,
    port: 6543,
    database: 'postgres',
    user: `postgres.${referencia}`,
    password: 'sonda-de-diagnostico-nunca-autentica',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try {
    await cliente.connect();
    await cliente.end();
    // Nao deveria acontecer. Se acontecer, o host conhece o tenant.
    return 'password authentication failed';
  } catch (erro: any) {
    return String(erro?.message ?? '');
  }
}
