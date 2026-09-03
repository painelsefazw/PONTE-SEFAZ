/**
 * O que todo template do cliente herda quando o cadastro dele nao diz.
 *
 * Suporte e paginas legais sao quase sempre OS MESMOS em todos os clientes: o
 * atendimento e o seu, o site e o seu, os termos sao os seus. Sem um padrao,
 * cada cliente novo exigia redigitar as seis coisas — e quem esquece uma entrega
 * uma plataforma com a aba de Suporte pela metade.
 *
 * O padrao NUNCA sobrescreve o cliente: quem tem valor proprio usa o dele. Um
 * cliente com suporte proprio existe (revenda dentro da revenda), e sobrepor o
 * dele mandaria o cliente final ligar para a pessoa errada.
 *
 * Mora em `webapp_config`, a mesma tabela chave-valor do SMTP: sao seis campos
 * de texto sem relacao com cliente nenhum, e criar tabela para isso seria
 * cerimonia sem ganho.
 */

export interface PadroesDaPlataforma {
  suporteEmail: string;
  suporteTelefone: string;
  suporteWhatsapp: string;
  suporteSite: string;
  termosUrl: string;
  privacidadeUrl: string;
}

/** Prefixo proprio: `webapp_config` e compartilhada com o SMTP. */
const PREFIXO = 'padrao_';

export const CAMPOS_DO_PADRAO: Array<keyof PadroesDaPlataforma> = [
  'suporteEmail', 'suporteTelefone', 'suporteWhatsapp',
  'suporteSite', 'termosUrl', 'privacidadeUrl',
];

const VAZIO: PadroesDaPlataforma = {
  suporteEmail: '', suporteTelefone: '', suporteWhatsapp: '',
  suporteSite: '', termosUrl: '', privacidadeUrl: '',
};

function chaveDe(campo: string): string {
  return PREFIXO + campo.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

export async function lerPadroes(pool: any): Promise<PadroesDaPlataforma> {
  const r = await pool.query(
    `SELECT chave, valor FROM webapp_config WHERE chave LIKE $1`, [PREFIXO + '%']);
  const achados: Record<string, string> = {};
  for (const linha of r.rows) achados[String(linha.chave)] = String(linha.valor ?? '');
  const saida = { ...VAZIO };
  for (const campo of CAMPOS_DO_PADRAO) {
    saida[campo] = achados[chaveDe(campo)] ?? '';
  }
  return saida;
}

export async function gravarPadroes(
  pool: any, entrada: Partial<PadroesDaPlataforma>,
): Promise<void> {
  for (const campo of CAMPOS_DO_PADRAO) {
    const valor = String(entrada[campo] ?? '').trim();
    // Campo apagado sai da tabela em vez de virar string vazia: `''` gravado
    // continuaria "existindo" e venceria o `||` de quem le, entregando um
    // padrao em branco que parece configurado.
    if (!valor) {
      await pool.query(`DELETE FROM webapp_config WHERE chave = $1`, [chaveDe(campo)]);
      continue;
    }
    await pool.query(
      `INSERT INTO webapp_config (chave, valor) VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [chaveDe(campo), valor],
    );
  }
}

/**
 * O valor do cliente, e o padrao so quando ele nao tem.
 *
 * `trim()` antes de decidir: um campo com um espaco e vazio para quem le a
 * tela, e sem isso ele venceria o padrao e entregaria um contato em branco.
 */
export function comPadrao<T extends object>(
  doCliente: T, padroes: PadroesDaPlataforma,
): T {
  const saida = { ...doCliente } as Record<string, unknown>;
  const origem = doCliente as Record<string, unknown>;
  for (const campo of CAMPOS_DO_PADRAO) {
    const atual = String(origem[campo] ?? '').trim();
    if (!atual && padroes[campo]) saida[campo] = padroes[campo];
  }
  return saida as T;
}
