import { createServerFn } from "@tanstack/react-start";
import { getPainelSession, passwordMatches } from "./auth.server";
import { faltamVariaveis, usuarioDoPainel } from "./config.server";

/**
 * O usuario e o CNPJ, e CNPJ se digita com pontuacao.
 *
 * A propria tela de login mostra "CNPJ 00.000.000/0000-00" embaixo do botao —
 * entao o caminho natural e digitar exatamente aquilo, com pontos e barra. A
 * comparacao era literal e recusava com "Credenciais invalidas", que manda a
 * pessoa procurar erro na senha. O sistema convidava a errar e depois nao dizia
 * onde.
 *
 * Pontuacao e FORMATACAO, e formatacao se corrige sozinha; o que se recusa e
 * ambiguidade. Aqui nao ha ambiguidade nenhuma: 00.000.000/0000-00 e
 * 00000000000000 sao o mesmo documento.
 *
 * A comparacao so digitos vale quando o usuario esperado E um documento — 11
 * digitos (CPF) ou 14 (CNPJ) —, esteja ele guardado formatado ou nao.
 * Instalacao que trocou `APP_USER` por um nome continua na comparacao literal:
 * senao "joao1" e "joao-1" passariam a ser a mesma pessoa.
 */
function usuarioConfere(informado: string, esperado: string): boolean {
  const a = informado.trim().toLowerCase();
  const b = esperado.trim().toLowerCase();
  if (passwordMatches(a, b)) return true;

  const digitosEsperados = b.replace(/\D/g, "");
  const ehDocumento = digitosEsperados.length === 11 || digitosEsperados.length === 14;
  if (!ehDocumento) return false;

  return passwordMatches(a.replace(/\D/g, ""), digitosEsperados);
}

export const entrar = createServerFn({ method: "POST" })
  .inputValidator((data: { usuario: string; senha: string }) => data)
  .handler(async ({ data }) => {
    const expected = process.env["APP_ACCESS_PASSWORD"];
    // O usuario e o CNPJ do manifest quando ninguem cadastra `APP_USER`.
    const usuarioEsperado = usuarioDoPainel();
    if (!expected || !usuarioEsperado) {
      return { ok: false as const, error: "Acesso n\u00e3o configurado no servidor." };
    }
    if (!data.usuario?.trim() || !data.senha) {
      return { ok: false as const, error: "Informe usu\u00e1rio e senha." };
    }
    const usuarioOk = usuarioConfere(data.usuario, usuarioEsperado);
    const senhaOk = passwordMatches(data.senha, expected);
    if (!usuarioOk || !senhaOk) {
      return { ok: false as const, error: "Credenciais inv\u00e1lidas." };
    }
    const session = await getPainelSession();
    await session.update({ authenticated: true, user: data.usuario.trim() });
    return { ok: true as const };
  });

export const sair = createServerFn({ method: "POST" }).handler(async () => {
  const session = await getPainelSession();
  await session.clear();
  return { ok: true as const };
});

export const sessaoAtual = createServerFn({ method: "GET" }).handler(async () => {
  // A conferencia vem ANTES de tocar na sessao, e essa ordem e o ponto: abrir a
  // sessao sem `SESSION_SECRET` lanca "Empty password" e derruba a pagina, entao
  // perguntar depois nunca chegaria a acontecer.
  const faltando = faltamVariaveis();
  if (faltando.length) {
    return { authenticated: false, user: null, configPendente: faltando };
  }

  const session = await getPainelSession();
  return {
    authenticated: Boolean(session.data.authenticated),
    user: session.data.user ?? null,
    configPendente: [] as string[],
  };
});
