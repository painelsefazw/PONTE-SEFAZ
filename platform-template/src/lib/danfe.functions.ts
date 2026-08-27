import { createServerFn } from "@tanstack/react-start";
import { apiFetch, requireAuth, type ApiResult } from "./fiscal.server";

/**
 * A logomarca que sai impressa no DANFE desta empresa.
 *
 * O quadro do emitente no DANFE tem espaço reservado para ela desde sempre, e a
 * biblioteca que desenha o documento sabe preenchê-lo. O que faltava era de
 * onde tirar a imagem: o XML da NF-e não carrega figura nenhuma. Sem isto, toda
 * nota saía com aquele espaço em branco — justamente no papel que esta empresa
 * entrega ao cliente dela.
 */

export type MarcaDoDanfe = {
  configurada: boolean;
  /** PNG ou JPG em base64, sem o prefixo `data:`. */
  logoBase64?: string | undefined;
  /** `L` esquerda, `C` centro, `R` direita, dentro do quadro do emitente. */
  posicao?: "L" | "C" | "R" | undefined;
  atualizadaEm?: string | undefined;
};

export const obterMarcaDoDanfe = createServerFn({ method: "GET" })
  .handler(async (): Promise<ApiResult<MarcaDoDanfe>> => {
    await requireAuth();
    return apiFetch("/api/danfe/marca");
  });

export const salvarMarcaDoDanfe = createServerFn({ method: "POST" })
  .inputValidator((data: { logoBase64: string; posicao?: "L" | "C" | "R" }) => data)
  .handler(async ({ data }): Promise<ApiResult<{ sucesso?: boolean }>> => {
    await requireAuth();
    return apiFetch("/api/danfe/marca", {
      method: "POST",
      body: {
        // O prefixo `data:image/png;base64,` que o FileReader do navegador
        // devolve é aceito e removido do outro lado — exigir que a tela o tire
        // seria transferir para ela um trabalho de uma linha.
        logoBase64: data.logoBase64,
        posicao: data.posicao ?? "L",
      },
    });
  });

export const removerMarcaDoDanfe = createServerFn({ method: "POST" })
  .handler(async (): Promise<ApiResult<{ sucesso?: boolean }>> => {
    await requireAuth();
    return apiFetch("/api/danfe/marca", { method: "DELETE" });
  });
