import { getRequestProtocol, useSession } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual } from "node:crypto";

import { escopo } from "./manifest";
import { segredoDeSessao } from "./config.server";

export type PainelSession = { authenticated?: boolean; user?: string };

/**
 * A regra do cookie sai do PROTOCOLO da requisição, não do modo de build.
 *
 * Antes saía de `import.meta.env.DEV`, e isso quebrava justamente onde mais se
 * usa: o **preview do construtor**. Ali a aplicação roda em modo
 * desenvolvimento, mas dentro de um iframe — e o navegador descarta cookie
 * `SameSite=Lax` em contexto cross-site. O login dava certo no servidor, o
 * cookie nunca era guardado, e a tela voltava para o login **sem erro nenhum**.
 * O comentário antigo até descrevia esse sintoma; só atribuía a outra causa.
 *
 * O protocolo separa os dois casos sem depender de build: `https` (preview
 * publicado ou site do cliente) pede `Secure` + `SameSite=None`, que atravessa
 * iframe; `http` (localhost) não aceita `Secure`, e ali `Lax` é o que funciona.
 *
 * `getRequestProtocol` já considera `x-forwarded-proto`, que é como o protocolo
 * real chega atrás de proxy — sem isso, todo deploy pareceria HTTP.
 */
function conexaoSegura(): boolean {
  try {
    return getRequestProtocol() === "https";
  } catch {
    // Fora de uma requisição (build, script) não há protocolo para ler. Cai no
    // lado restritivo: nunca desligar `Secure` por não saber.
    return true;
  }
}

export function sessionConfig() {
  return {
    // Derivado da chave da API quando `SESSION_SECRET` nao vem — uma
    // variavel a menos para cadastrar, sem segredo fixo no codigo.
    password: segredoDeSessao(),
    // Por instalacao: duas plataformas sob o mesmo dominio de
    // pre-visualizacao compartilhavam o cookie, e entrar numa derrubava a
    // sessao da outra.
    name: `${escopo}-session`,
    maxAge: 60 * 60 * 8,
    // Em HTTPS: `Secure` + `SameSite=None`, que e o unico par que atravessa
    // iframe — e o preview do construtor e um iframe.
    //
    // Em HTTP (localhost): `Secure` e recusado pelo navegador, e sem ele
    // `SameSite=None` tambem e. Ali `Lax` e o que funciona, e nao ha iframe
    // para atravessar.
    cookie: conexaoSegura()
      ? { httpOnly: true, secure: true, sameSite: "none" as const, path: "/" }
      : { httpOnly: true, secure: false, sameSite: "lax" as const, path: "/" },
  };
}

export function getPainelSession() {
  return useSession<PainelSession>(sessionConfig());
}

export function passwordMatches(input: string, expected: string) {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
