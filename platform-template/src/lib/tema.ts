/**
 * Tema claro e escuro.
 *
 * As cores já existiam em `styles.css`, em `:root` e `.dark`. O que faltava era
 * quem decide qual das duas vale — e lembrar da escolha.
 *
 * São três estados, não dois: claro, escuro e **sistema**. O terceiro é o
 * padrão porque quem configurou o computador em modo escuro espera que tudo
 * acompanhe, e porque ele é o único que muda sozinho quando anoitece.
 */

import { escopo } from "./manifest";

export type Tema = "claro" | "escuro" | "sistema";

// Por instalacao, nao fixo: na pre-visualizacao do construtor varias
// plataformas vivem sob o MESMO dominio, e uma chave fixa fazia o cliente A
// abrir com o tema escolhido no cliente B.
const CHAVE = `${escopo}:tema`;

/** O que o sistema operacional do usuário está pedindo agora. */
export function temaDoSistema(): "claro" | "escuro" {
  if (typeof window === "undefined") return "claro";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
}

export function temaSalvo(): Tema {
  if (typeof window === "undefined") return "sistema";
  const v = window.localStorage.getItem(CHAVE);
  return v === "claro" || v === "escuro" || v === "sistema" ? v : "sistema";
}

/** Aplica no `<html>`: é o `.dark` que os tokens do CSS esperam. */
export function aplicarTema(tema: Tema): void {
  if (typeof document === "undefined") return;
  const escuro = tema === "escuro" || (tema === "sistema" && temaDoSistema() === "escuro");
  document.documentElement.classList.toggle("dark", escuro);
  // A barra de rolagem e os campos nativos seguem isto; sem ele, um input de
  // data aparece branco no meio da tela escura.
  document.documentElement.style.colorScheme = escuro ? "dark" : "light";
}

export function salvarTema(tema: Tema): void {
  if (typeof window !== "undefined") window.localStorage.setItem(CHAVE, tema);
  aplicarTema(tema);
}

/**
 * Roda antes da primeira pintura, dentro do `<head>`.
 *
 * Sem isto a página nasce clara e vira escura no primeiro frame — o flash
 * branco que denuncia que o tema é remendo. Fica como string porque precisa ser
 * um `<script>` inline, executado antes do React existir.
 */
export const SCRIPT_ANTI_FLASH = `
(function(){try{
  var t=localStorage.getItem("${CHAVE}")||"sistema";
  var escuro=t==="escuro"||(t==="sistema"&&matchMedia("(prefers-color-scheme: dark)").matches);
  if(escuro)document.documentElement.classList.add("dark");
  document.documentElement.style.colorScheme=escuro?"dark":"light";
}catch(e){}})();
`.trim();

/**
 * Avisa quando o sistema troca de tema, para o modo "sistema" acompanhar sem
 * recarregar. Devolve a função que cancela a escuta.
 */
export function ouvirSistema(aoMudar: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", aoMudar);
  return () => mq.removeEventListener("change", aoMudar);
}
