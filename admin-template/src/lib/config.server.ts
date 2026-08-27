import { createHmac } from "node:crypto";

import { VARIAVEIS_OBRIGATORIAS } from "./config";

/**
 * Nomes das obrigatorias ausentes ou vazias.
 *
 * String vazia conta como ausente: variavel cadastrada em branco no provedor e o
 * engano mais comum, e ela passa numa checagem escrita na mao. Aconteceu com o
 * GITHUB_TOKEN da ponte — cadastrado, salvo, e vazio.
 */
export function faltamVariaveis(): string[] {
  return VARIAVEIS_OBRIGATORIAS
    .filter(({ nome }) => !String(process.env[nome] ?? "").trim())
    .map(({ nome }) => nome);
}

/** Endereco da ponte, sem barra no fim — o resto do codigo concatena caminhos. */
export function urlDaPonte(): string {
  return String(process.env["EMISSOR_API_URL"] ?? "").trim().replace(/\/+$/, "");
}

/**
 * A credencial administrativa da ponte.
 *
 * Vai no header `x-api-key`, o mesmo das chaves de cliente: a ponte compara o
 * valor recebido com a `WEBAPP_SENHA` dela e, batendo, trata a requisicao como
 * administrativa. Nao existe header proprio de admin.
 *
 * **So o servidor le isto.** Esta funcao vive num modulo `.server` e nunca
 * atravessa para o bundle do navegador — um console que exponha esta chave
 * entrega o cadastro de todos os clientes a quem abrir o DevTools.
 */
export function chaveDaPonte(): string {
  return String(process.env["EMISSOR_ADMIN_KEY"] ?? "").trim();
}

/** Usuario do console. Sem cadastrar, `admin`. */
export function usuarioDoPainel(): string {
  return String(process.env["APP_USER"] ?? "").trim() || "admin";
}

/**
 * Segredo que assina o cookie de sessao.
 *
 * Sem `SESSION_SECRET`, e DERIVADO da chave da ponte — que ja e um segredo
 * forte, ja esta cadastrada e so existe no servidor. Uma variavel a menos para
 * cadastrar, sem baixar a guarda: o HMAC nao permite voltar dele para a chave.
 *
 * Isto NAO e um padrao embutido no codigo. Padrao fixo seria publico, e qualquer
 * um que lesse o repositorio assinaria um cookie valido para qualquer
 * instalacao. Aqui, duas instalacoes com chaves diferentes tem segredos
 * diferentes.
 *
 * O preco: trocar a chave da ponte derruba as sessoes abertas. E o comportamento
 * certo — chave rotacionada costuma ser chave comprometida —, mas nao pode ser
 * surpresa.
 */
export function segredoDeSessao(): string {
  const explicito = String(process.env["SESSION_SECRET"] ?? "").trim();
  if (explicito) return explicito;

  const chave = chaveDaPonte();
  if (!chave) return "";

  // O rotulo separa este uso de qualquer outro derivado da mesma chave.
  return createHmac("sha256", chave).update("sessao:v1").digest("base64url");
}
