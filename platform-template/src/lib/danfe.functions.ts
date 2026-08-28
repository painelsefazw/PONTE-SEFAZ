import { createServerFn } from "@tanstack/react-start";
import { apiFetch, requireAuth, type ApiResult } from "./fiscal.server";

/**
 * Os parâmetros do DANFE desta empresa: a logo e o texto fixo.
 *
 * O quadro do emitente tem espaço reservado para a logomarca desde sempre, e a
 * biblioteca que desenha o documento sabe preenchê-lo. O que faltava era de
 * onde tirar a imagem: o XML da NF-e não carrega figura nenhuma. Sem isto, toda
 * nota saía com aquele espaço em branco — justamente no papel que esta empresa
 * entrega ao cliente dela.
 *
 * O texto fixo é o outro lado do mesmo problema. A frase que a empresa repete
 * em toda nota — dados bancários, prazo de garantia, o aviso que a
 * contabilidade exige — ou era digitada a cada emissão, e um dia esquecida, ou
 * virava regra dentro do ERP, que não é lugar dela.
 */

export type MarcaDoDanfe = {
  configurada: boolean;
  /** PNG ou JPG em base64, sem o prefixo `data:`. */
  logoBase64?: string | undefined;
  /** `L` esquerda, `C` centro, `R` direita, dentro do quadro do emitente. */
  posicao?: "L" | "C" | "R" | undefined;
  /** Sai em "Informações complementares", somado ao texto do pedido. */
  textoPadrao?: string | undefined;
  atualizadaEm?: string | undefined;
};

/** O mesmo teto que o servidor aplica — repetido aqui para avisar antes de enviar. */
export const LIMITE_DO_TEXTO = 2000;

export const obterMarcaDoDanfe = createServerFn({ method: "GET" })
  .handler(async (): Promise<ApiResult<MarcaDoDanfe>> => {
    await requireAuth();
    return apiFetch("/api/danfe/marca");
  });

/**
 * Salva só o que foi enviado.
 *
 * Logo e texto vivem em abas separadas, e um `undefined` aqui significa "não
 * mexe" do outro lado. Mandar os dois sempre faria salvar o texto apagar a logo
 * — e isso só apareceria no primeiro DANFE impresso depois.
 */
export const salvarMarcaDoDanfe = createServerFn({ method: "POST" })
  .inputValidator((data: {
    logoBase64?: string;
    posicao?: "L" | "C" | "R";
    textoPadrao?: string;
  }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ sucesso?: boolean }>> => {
    await requireAuth();
    const body: Record<string, unknown> = {};
    // O prefixo `data:image/png;base64,` que o FileReader do navegador devolve
    // é aceito e removido do outro lado — exigir que a tela o tire seria
    // transferir para ela um trabalho de uma linha.
    if (data.logoBase64 !== undefined) body["logoBase64"] = data.logoBase64;
    if (data.posicao !== undefined) body["posicao"] = data.posicao;
    if (data.textoPadrao !== undefined) body["textoPadrao"] = data.textoPadrao;
    return apiFetch("/api/danfe/marca", { method: "POST", body });
  });

/** Apaga logo e texto de uma vez. Para tirar só um, salve-o vazio. */
export const removerMarcaDoDanfe = createServerFn({ method: "POST" })
  .handler(async (): Promise<ApiResult<{ sucesso?: boolean }>> => {
    await requireAuth();
    return apiFetch("/api/danfe/marca", { method: "DELETE" });
  });
