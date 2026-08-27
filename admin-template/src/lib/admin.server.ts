import { chaveDaPonte, urlDaPonte } from "./config.server";
import { getPainelSession } from "./auth.server";

/**
 * A conversa com a ponte fiscal, do lado do servidor.
 *
 * **Nada aqui pode atravessar para o navegador.** A chave administrativa da
 * ponte abre o cadastro de todos os clientes, os certificados e a geracao de
 * chaves de API — um console que a exponha entrega tudo a quem abrir o DevTools.
 * O arquivo termina em `.server` justamente para o empacotador recusar importa-lo
 * de um componente de tela.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Toda funcao de servidor comeca por aqui.
 *
 * Sem a sessao conferida, o console viraria um proxy aberto: qualquer pessoa que
 * descobrisse o endereco chamaria as rotas administrativas da ponte usando a
 * chave que esta no servidor — sem nunca precisar dela.
 */
export async function requireAuth(): Promise<void> {
  const session = await getPainelSession();
  if (!session.data.authenticated) throw new Error("Nao autorizado. Entre no console.");
}

/**
 * Traduz o que deu errado para uma frase que diz o que fazer.
 *
 * A ponte responde JSON com `erro` em quase tudo; quando nao responde, o status
 * sozinho nao explica nada a quem opera.
 */
function mensagemPorStatus(status: number, doCorpo: string | null): string {
  // Credencial recusada e a unica em que a frase da ponte ATRAPALHA: ela responde
  // "Informe a senha de acesso", pensando em quem usa o painel dela. Quem opera
  // este console nao tem senha nenhuma para informar — o que ele precisa saber e
  // qual variavel esta errada.
  if (status === 401 || status === 403) {
    return "A ponte recusou a credencial. Confira EMISSOR_ADMIN_KEY — "
      + "ela precisa ser exatamente a WEBAPP_SENHA da instalacao."
      + (doCorpo ? ` (a ponte disse: ${doCorpo})` : "");
  }
  if (doCorpo) return doCorpo;
  if (status === 404) return "Rota nao encontrada na ponte. Confira EMISSOR_API_URL.";
  if (status === 429) return "A ponte limitou as requisicoes. Espere um instante.";
  if (status >= 500) return `A ponte respondeu com erro ${status}.`;
  return `A ponte respondeu ${status}.`;
}

function mensagemDoCorpo(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== "object") return null;
  const c = corpo as Record<string, unknown>;
  const erro = c["erro"] ?? c["error"] ?? c["message"];
  if (typeof erro !== "string") return null;
  // `comoResolver` e a metade util da resposta em varias rotas da ponte —
  // descartar deixaria o operador com o diagnostico e sem o conserto.
  const ajuda = typeof c["comoResolver"] === "string" ? ` ${c["comoResolver"]}` : "";
  return erro + ajuda;
}

export async function pedir<T>(
  caminho: string,
  init?: { method?: string; body?: unknown },
): Promise<ApiResult<T>> {
  const base = urlDaPonte();
  const chave = chaveDaPonte();
  if (!base) return { ok: false, error: "EMISSOR_API_URL nao configurada no servidor." };
  if (!chave) return { ok: false, error: "EMISSOR_ADMIN_KEY nao configurada no servidor." };

  try {
    const res = await fetch(`${base}${caminho}`, {
      method: init?.method ?? "GET",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // Nao ha header proprio de admin: a ponte compara este valor com a
        // WEBAPP_SENHA dela e, batendo, trata a requisicao como administrativa.
        "x-api-key": chave,
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

    const texto = await res.text();
    let corpo: unknown = null;
    try { corpo = texto ? JSON.parse(texto) : null; } catch { /* nem toda resposta e JSON */ }

    if (!res.ok) return { ok: false, error: mensagemPorStatus(res.status, mensagemDoCorpo(corpo)) };
    return { ok: true, data: corpo as T };
  } catch (erro) {
    return {
      ok: false,
      error: erro instanceof Error
        ? `Nao foi possivel falar com a ponte: ${erro.message}`
        : "Nao foi possivel falar com a ponte.",
    };
  }
}

/** Baixa um arquivo da ponte e devolve em base64, para o navegador salvar. */
export async function pedirArquivo(
  caminho: string,
): Promise<ApiResult<{ base64: string; tipo: string }>> {
  const base = urlDaPonte();
  const chave = chaveDaPonte();
  if (!base || !chave) return { ok: false, error: "Console nao configurado no servidor." };

  try {
    const res = await fetch(`${base}${caminho}`, {
      headers: { accept: "*/*", "x-api-key": chave },
    });
    if (!res.ok) {
      const texto = await res.text().catch(() => "");
      let doCorpo: string | null = null;
      try { doCorpo = mensagemDoCorpo(JSON.parse(texto)); } catch { /* nao era JSON */ }
      return { ok: false, error: mensagemPorStatus(res.status, doCorpo) };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { ok: false, error: "A ponte devolveu um arquivo vazio." };
    return {
      ok: true,
      data: {
        base64: buf.toString("base64"),
        tipo: res.headers.get("content-type") || "application/octet-stream",
      },
    };
  } catch (erro) {
    return {
      ok: false,
      error: erro instanceof Error ? erro.message : "Falha ao baixar o arquivo.",
    };
  }
}
