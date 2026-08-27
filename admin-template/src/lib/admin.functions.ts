import { createServerFn } from "@tanstack/react-start";
import { pedir, pedirArquivo, requireAuth, type ApiResult } from "./admin.server";

/**
 * As acoes do console, cada uma como funcao de servidor.
 *
 * Nenhuma chamada sai do navegador direto para a ponte, e isso nao e detalhe de
 * arquitetura: a credencial administrativa vive so aqui. O componente pede a
 * acao; o servidor e quem conhece a chave.
 */

export type StatusCliente =
  | "draft" | "sandbox" | "active" | "past_due" | "suspended" | "cancelled";

export type Cliente = {
  empresaCnpj: string;
  razaoSocial: string;
  fantasia?: string | undefined;
  codigoInterno?: string | undefined;
  status: StatusCliente;
  plano: string;
  responsavel?: string | undefined;
  emailTecnico?: string | undefined;
  whiteLabelAtiva?: boolean | undefined;
  temCertificado?: boolean | undefined;
  certificadoVencimento?: string | undefined;
  repositoryUrl?: string | undefined;
  ultimaPublicacaoCommit?: string | undefined;
  ultimaPublicacaoEm?: string | undefined;
  ultimoUsoApi?: string | undefined;
  criadoEm?: string | undefined;
};

/**
 * O que as rotas de acao devolvem.
 *
 * `unknown` nao atravessa a fronteira servidor->cliente: o TanStack precisa de
 * um tipo serializavel declarado, e recusa em tempo de compilacao. Melhor assim
 * — o que volta da ponte nessas rotas e sempre um envelope simples.
 */
export type Resposta = { sucesso?: boolean | undefined; erro?: string | undefined };

/**
 * O que a geracao de plataforma devolve.
 *
 * O manifest inteiro nao entra no tipo de proposito: ele carrega a logo em
 * base64 e passa de 400 KB. O console so precisa saber que deu certo e qual
 * geracao foi — quem consome o manifest e o kit, nao esta tela.
 */
export type ManifestGerado = {
  sucesso?: boolean | undefined;
  geracaoId?: number | string | undefined;
  servicos?: string[] | undefined;
  repositoryUrl?: string | undefined;
};

export type ServicoContratado = { service: string; active?: boolean | undefined };

export type ChaveDeApi = {
  id: number;
  nome?: string | undefined;
  prefixo?: string | undefined;
  ativa?: boolean | undefined;
  escopo?: string | undefined;
  /** "homologacao", "producao" ou "ambos". */
  ambientePermitido?: string | undefined;
};

/** O que o plano promete e o que esta ativado nao batem. */
export type DivergenciaDePlano = { faltam: string[]; sobram: string[] };

export type DetalheDoCliente = Cliente & {
  servicos?: ServicoContratado[] | undefined;
  divergenciaPlano?: DivergenciaDePlano | undefined;
  limites?: Record<string, number> | undefined;
};

function lista<T>(bruto: unknown, chave: string): T[] {
  if (Array.isArray(bruto)) return bruto as T[];
  if (bruto && typeof bruto === "object") {
    const v = (bruto as Record<string, unknown>)[chave];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export const listarClientes = createServerFn({ method: "POST" })
  .inputValidator((data: { busca?: string | undefined; status?: string | undefined }) => data)
  .handler(async ({ data }): Promise<ApiResult<Cliente[]>> => {
    await requireAuth();
    const params = new URLSearchParams();
    if (data.busca?.trim()) params.set("q", data.busca.trim());
    if (data.status && data.status !== "todos") params.set("status", data.status);
    const sufixo = params.toString() ? `?${params}` : "";
    const res = await pedir<unknown>(`/api/admin/clients${sufixo}`);
    if (!res.ok) return res;
    return { ok: true, data: lista<Cliente>(res.data, "clients") };
  });

export const obterCliente = createServerFn({ method: "POST" })
  .inputValidator((data: { cnpj: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<DetalheDoCliente>> => {
    await requireAuth();
    return pedir<DetalheDoCliente>(`/api/admin/clients/${soDigitos(data.cnpj)}`);
  });

export const criarCliente = createServerFn({ method: "POST" })
  .inputValidator((data: { cliente: Record<string, string> }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ sucesso?: boolean }>> => {
    await requireAuth();
    const c = data.cliente;
    const cnpj = soDigitos(c["empresaCnpj"] ?? "");
    // Conferir aqui poupa uma ida a ponte so para receber de volta o que a tela
    // ja sabia — e um CNPJ de 13 digitos e erro de digitacao, nao de negocio.
    if (cnpj.length !== 14) return { ok: false, error: "O CNPJ precisa ter 14 digitos." };
    if (!c["razaoSocial"]?.trim()) return { ok: false, error: "Informe a razao social." };
    return pedir("/api/admin/clients", { method: "POST", body: { ...c, empresaCnpj: cnpj } });
  });

export const mudarStatusDoCliente = createServerFn({ method: "POST" })
  .inputValidator((data: { cnpj: string; status: StatusCliente }) => data)
  .handler(async ({ data }): Promise<ApiResult<Resposta>> => {
    await requireAuth();
    return pedir(`/api/admin/clients/${soDigitos(data.cnpj)}/status`, {
      method: "POST",
      body: { status: data.status },
    });
  });

// ---------------------------------------------------------------------------
// Chaves de API
// ---------------------------------------------------------------------------

export const listarChaves = createServerFn({ method: "POST" })
  .inputValidator((data: { cnpj: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<ChaveDeApi[]>> => {
    await requireAuth();
    const res = await pedir<unknown>(`/api/admin/clients/${soDigitos(data.cnpj)}/keys`);
    if (!res.ok) return res;
    return { ok: true, data: lista<ChaveDeApi>(res.data, "keys") };
  });

/**
 * Gera uma chave. **O valor completo volta uma unica vez, nesta resposta.**
 *
 * A ponte guarda so o hash: se a tela perder o valor, nao ha como recuperar —
 * so gerar outra. Por isso a interface mostra a chave em destaque e nao a
 * esconde atras de um toast que some sozinho.
 */
export const gerarChave = createServerFn({ method: "POST" })
  .inputValidator((data: { cnpj: string; nome?: string; ambiente?: string; escopo?: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ chave?: string; apiKey?: string }>> => {
    await requireAuth();
    return pedir(`/api/admin/clients/${soDigitos(data.cnpj)}/keys`, {
      method: "POST",
      body: {
        nome: data.nome || "Integracao",
        // Sem `ambiente` explicito a chave herda o cadastro da empresa — e uma
        // chave que emite em teste sem ninguem perceber, ou pior, em producao.
        ambiente: data.ambiente || "homologacao",
        ...(data.escopo ? { escopo: data.escopo } : {}),
      },
    });
  });

export const revogarChave = createServerFn({ method: "POST" })
  .inputValidator((data: { cnpj: string; id: number }) => data)
  .handler(async ({ data }): Promise<ApiResult<Resposta>> => {
    await requireAuth();
    return pedir(`/api/admin/clients/${soDigitos(data.cnpj)}/keys/${data.id}`, { method: "DELETE" });
  });

// ---------------------------------------------------------------------------
// Servicos contratados
// ---------------------------------------------------------------------------

export const ativarServico = createServerFn({ method: "POST" })
  .inputValidator((data: { cnpj: string; service: "nfe" | "nfce" | "nfse" }) => data)
  .handler(async ({ data }): Promise<ApiResult<Resposta>> => {
    await requireAuth();
    return pedir(`/api/admin/clients/${soDigitos(data.cnpj)}/services`, {
      method: "POST",
      body: { service: data.service },
    });
  });

export const desativarServico = createServerFn({ method: "POST" })
  .inputValidator((data: { cnpj: string; service: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<Resposta>> => {
    await requireAuth();
    return pedir(
      `/api/admin/clients/${soDigitos(data.cnpj)}/services/${encodeURIComponent(data.service)}`,
      { method: "DELETE" },
    );
  });

// ---------------------------------------------------------------------------
// Plataforma do cliente
// ---------------------------------------------------------------------------

export const gerarPlataforma = createServerFn({ method: "POST" })
  .inputValidator((data: { cnpj: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<ManifestGerado>> => {
    await requireAuth();
    return pedir(`/api/admin/clients/${soDigitos(data.cnpj)}/generate-platform`, {
      method: "POST",
      body: {},
    });
  });

export const baixarKitDoCliente = createServerFn({ method: "POST" })
  .inputValidator((data: { cnpj: string; marca?: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ nome: string; tipo: string; base64: string }>> => {
    await requireAuth();
    const res = await pedirArquivo(`/api/admin/clients/${soDigitos(data.cnpj)}/kit.zip`);
    if (!res.ok) return res;
    const nome = `plataforma-${(data.marca || soDigitos(data.cnpj)).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.zip`;
    return { ok: true, data: { nome, tipo: res.data.tipo, base64: res.data.base64 } };
  });

/**
 * Testa o alcance do token do GitHub, sem escrever nada.
 *
 * Existe porque os modos de falha da publicacao sao indistinguiveis de fora —
 * variavel ausente, variavel vazia, token vencido, repositorio fora do escopo e
 * permissao so de leitura produzem todos o mesmo "nao publicou".
 */
export const testarRepositorio = createServerFn({ method: "POST" })
  .inputValidator((data: { repositoryUrl: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<{
    estado: string; podePublicar: boolean; mensagem: string; comoResolver?: string;
  }>> => {
    await requireAuth();
    if (!data.repositoryUrl.trim()) return { ok: false, error: "Cole a URL do repositorio." };
    return pedir("/api/admin/github/verificar", {
      method: "POST",
      body: { repositoryUrl: data.repositoryUrl.trim() },
    });
  });

export const publicarPlataforma = createServerFn({ method: "POST" })
  .inputValidator((data: { cnpj: string; repositoryUrl: string }) => data)
  .handler(async ({ data }): Promise<ApiResult<{
    sucesso?: boolean; commit?: string; branch?: string; arquivos?: number;
  }>> => {
    await requireAuth();
    if (!data.repositoryUrl.trim()) return { ok: false, error: "Cole a URL do repositorio." };
    return pedir(`/api/admin/clients/${soDigitos(data.cnpj)}/publicar-repositorio`, {
      method: "POST",
      body: { repositoryUrl: data.repositoryUrl.trim() },
    });
  });

function soDigitos(v: string): string {
  return String(v ?? "").replace(/\D/g, "");
}
