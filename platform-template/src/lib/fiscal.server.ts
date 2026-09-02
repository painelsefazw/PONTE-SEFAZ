import { getPainelSession } from "./auth.server";
import { manifest } from "./manifest";

/**
 * Endereço da ponte que emite para ESTE cliente.
 *
 * Vem do manifest, que é gerado por instalação junto com o template. O padrão
 * era um domínio cravado aqui, e isso mandava a plataforma para a ponte errada:
 * o cliente foi cadastrado numa instalação, o manifest saiu apontando para ela,
 * e o código ignorava o manifest e falava com outra. Como as duas rodam o mesmo
 * servidor, a resposta era um 401 idêntico ao de chave revogada — a chave certa
 * batendo na porta de um banco que nunca ouviu falar dela. Levou horas para
 * achar, porque tudo o que a tela dizia estava correto: a chave existia, estava
 * ativa, e era recusada.
 *
 * `FISCAL_API_URL` continua valendo como sobrescrita, para o caso de a ponte
 * mudar de domínio depois de o template ter sido gerado.
 *
 * Nunca apontar para a URL de um deploy específico (`...-<hash>.vercel.app`):
 * ela muda a cada publicação e responde 302 por trás da proteção de deploy.
 */
const BASE_URL = String(process.env["FISCAL_API_URL"] ?? "").trim()
  || (manifest.api?.baseUrl ?? "");

/**
 * Credencial da API fiscal.
 *
 * `FISCAL_API_KEY` é o nome único, em todas as instalações. O modelo não aceita
 * nome alternativo de propósito: um segundo nome válido é uma variável que
 * ninguém encontra quando a credencial precisa ser trocada.
 *
 * Ela é lida SOMENTE no servidor. Nunca prefixe com `VITE_`: a chave emite nota
 * fiscal em nome da empresa, e o que leva esse prefixo vai para o navegador.
 */
function chaveDaApi(): string | undefined {
  return process.env["FISCAL_API_KEY"];
}
// Do manifest: sao o mesmo dado que o painel ja gerou, e deixa-los aqui
// significava que trocar de cliente exigia editar codigo.
const CNPJ = manifest.company.cnpj;
const CLIENT_ID = manifest.company.id;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function requireAuth() {
  const session = await getPainelSession();
  if (!session.data.authenticated) throw new Error("NAO_AUTENTICADO");
}

/** Mensagem por status, para o operador saber o que fazer com o erro. */
function mensagemPorStatus(status: number, doCorpo: string | null): string {
  if (doCorpo) return doCorpo;
  if (status === 401) return "Credencial da API inválida ou revogada. Fale com o suporte.";
  // 402 é o que para a emissão quando a cota do plano acaba. Sem ele na lista, a
  // mensagem virava "erro desconhecido" e ninguém descobria que basta renovar.
  if (status === 402) return "Limite de notas do plano atingido. Renove o plano para voltar a emitir.";
  if (status === 403) return "Este serviço não está contratado, ou a credencial não permite este ambiente.";
  if (status === 404) return "Recurso não encontrado na API fiscal.";
  if (status === 429) return "Muitas requisições em pouco tempo. Tente novamente em instantes.";
  if (status >= 500) return "O serviço fiscal está indisponível no momento.";
  return `Falha na comunicação com a API (HTTP ${status}).`;
}

/**
 * A mensagem de erro, venha ela de onde vier.
 *
 * A API usa dois envelopes: `{ erro }` na maioria das rotas e
 * `{ success: false, error: { code, message } }` nos erros de plano, serviço e
 * limite. Ler só o primeiro fazia justamente os erros que exigem ação do cliente
 * chegarem vazios na tela.
 */
function mensagemDoCorpo(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p["erro"] === "string" && p["erro"]) return p["erro"];

  // A NFS-e recusa em `erros` — plural, e cada item é um objeto
  // { codigo, descricao, complemento }. Sem tratar isto, o operador via
  // "[object Object]" ou nada, no lugar do motivo real da SEFIN.
  const lista = listaDeErros(p["erros"]);
  if (lista) return lista;

  const env = p["error"];
  if (env && typeof env === "object") {
    const m = (env as Record<string, unknown>)["message"];
    if (typeof m === "string" && m) return m;
  }
  return null;
}

/** Aceita array de strings ou de `{ codigo, descricao, complemento }`. */
function listaDeErros(v: unknown): string | null {
  if (!Array.isArray(v) || !v.length) return null;
  const textos = v.map((e) => {
    if (typeof e === "string") return e;
    if (e && typeof e === "object") {
      const o = e as Record<string, unknown>;
      const partes = [o["codigo"], o["descricao"] ?? o["message"], o["complemento"]]
        .filter((x) => typeof x === "string" && x);
      if (partes.length) return partes.join(" — ");
    }
    return null;
  }).filter(Boolean) as string[];
  return textos.length ? textos.join(" | ") : null;
}

/** `detalhes` nomeia o campo errado — é a informação mais útil que a API produz. */
function comDetalhes(mensagem: string, payload: unknown): string {
  const extra = listaDeErros((payload as { detalhes?: unknown })?.detalhes);
  return extra && !mensagem.includes(extra) ? `${mensagem} (${extra})` : mensagem;
}

/**
 * Busca um arquivo (XML ou PDF) e devolve em base64.
 *
 * O download precisa passar por aqui, e não por um link direto no navegador: a
 * chave da API é server-side e um link a exporia na barra de endereços, no
 * histórico e nos logs de quem estiver no meio do caminho.
 *
 * Volta em base64 porque server function devolve JSON; a tela remonta o arquivo
 * num Blob e dispara o download.
 */
export async function apiFetchArquivo(
  path: string,
): Promise<ApiResult<{ base64: string; tipo: string }>> {
  const apiKey = chaveDaApi();
  if (!apiKey) return { ok: false, error: "Credencial da API não configurada no servidor." };
  if (!BASE_URL) {
    return { ok: false, error: "Endereco da ponte nao configurado: defina FISCAL_API_URL." };
  }

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        accept: "*/*",
        "x-api-key": apiKey,
        "x-empresa-cnpj": CNPJ,
        "x-client-id": CLIENT_ID,
      },
    });

    if (!res.ok) {
      // A API responde erro em JSON mesmo nas rotas de arquivo.
      const texto = await res.text().catch(() => "");
      let doCorpo: string | null = null;
      try { doCorpo = mensagemDoCorpo(JSON.parse(texto)); } catch { /* não era JSON */ }
      return { ok: false, error: mensagemPorStatus(res.status, doCorpo) };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { ok: false, error: "A API devolveu um arquivo vazio." };

    return {
      ok: true,
      data: {
        base64: buf.toString("base64"),
        tipo: res.headers.get("content-type") ?? "application/octet-stream",
      },
    };
  } catch (error) {
    console.error("[fiscal-api:arquivo]", error);
    return { ok: false, error: "Não foi possível baixar o arquivo." };
  }
}

export async function apiFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ApiResult<T>> {
  const apiKey = chaveDaApi();
  if (!apiKey) return { ok: false, error: "Credencial da API não configurada no servidor." };
  if (!BASE_URL) {
    return { ok: false, error: "Endereco da ponte nao configurado: defina FISCAL_API_URL." };
  }

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-api-key": apiKey,
        "x-empresa-cnpj": CNPJ,
        "x-client-id": CLIENT_ID,
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });

    const text = await res.text();
    let payload: unknown = null;
    let jsonValido = true;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      jsonValido = false;
    }

    const doCorpo = mensagemDoCorpo(payload);

    // Falha de validação vem como 400 com `detalhes` nomeando o campo. Perder
    // esse array e mostrar só o status transforma a resposta mais útil da API em
    // "erro na comunicação".
    // 502 com `indefinido`: a API não conseguiu confirmar o envio à SEFAZ, e a
    // nota PODE ter sido autorizada. Aqui a chave de acesso é a informação mais
    // valiosa da resposta inteira — é com ela que se consulta antes de reemitir,
    // e reemitir às cegas gera duplicidade. Repassar só a frase de erro,
    // descartando chave, série e número, apagava justamente o que resolve.
    if (res.status === 502 && payload && typeof payload === "object"
        && (payload as { indefinido?: unknown }).indefinido) {
      const p = payload as { erro?: string; comoResolver?: string; chaveAcesso?: string; serie?: string; numero?: string };
      const partes = [
        p.erro ?? "Nao foi possivel confirmar o envio a SEFAZ.",
        p.chaveAcesso ? `Chave: ${p.chaveAcesso}` : null,
        p.serie && p.numero ? `Nota ${p.numero}, serie ${p.serie}.` : null,
        p.comoResolver ?? null,
      ].filter(Boolean);
      return { ok: false, error: partes.join(" ") };
    }

    if (!res.ok) {
      return { ok: false, error: comDetalhes(mensagemPorStatus(res.status, doCorpo), payload) };
    }

    // Resposta que não é JSON é erro, nunca lista vazia: "nada emitido" e
    // "não consegui falar com a API" são estados diferentes na tela.
    if (!jsonValido) {
      return { ok: false, error: "A API respondeu num formato inesperado." };
    }

    // A emissão devolve 200 com { sucesso: false } quando a SEFAZ rejeita.
    // Sem checar isso, rejeição virava tela de sucesso.
    if (payload && typeof payload === "object" && (payload as { sucesso?: unknown }).sucesso === false) {
      // `xMotivo` é a frase que a SEFAZ escreveu explicando a recusa. É o que o
      // operador precisa ler para corrigir — o resto é enfeite.
      const p = payload as { xMotivo?: unknown; cStat?: unknown };
      const daSefaz = typeof p.xMotivo === "string" && p.xMotivo
        ? `SEFAZ ${p.cStat ?? ""}: ${p.xMotivo}`.replace("SEFAZ : ", "SEFAZ: ")
        : null;
      return {
        ok: false,
        error: comDetalhes(daSefaz ?? doCorpo ?? "A SEFAZ rejeitou o documento.", payload),
      };
    }

    return { ok: true, data: payload as T };
  } catch (error) {
    console.error("[fiscal-api]", error);
    return { ok: false, error: "Não foi possível conectar ao serviço fiscal." };
  }
}
