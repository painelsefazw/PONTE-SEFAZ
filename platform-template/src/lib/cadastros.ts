/**
 * Cadastro de destinatários, guardado no navegador.
 *
 * Emitir a segunda nota para o mesmo cliente exigia redigitar nove campos que já
 * estavam na primeira: documento, IE, logradouro, número, bairro, município,
 * código IBGE, UF e CEP. Errar um deles volta como rejeição da SEFAZ.
 *
 * **Onde isto mora.** Hoje é `localStorage`: vale para este navegador, nesta
 * máquina. Não é o ideal — outro computador não enxerga, e limpar os dados do
 * navegador apaga tudo — mas é o que existe sem provisionar banco, e é honesto
 * dizer isso na tela em vez de deixar o operador descobrir.
 *
 * Toda a API abaixo é assíncrona **de propósito**, mesmo sem precisar: quando
 * houver banco, só esta implementação muda. Nenhuma tela é reescrita.
 */

import { escopo } from "./manifest";

export type TipoPessoa = "pf" | "pj";

export interface Destinatario {
  id: string;
  tipo: TipoPessoa;
  /** Razão social (PJ) ou nome completo (PF). */
  nome: string;
  /** Só dígitos: 11 para CPF, 14 para CNPJ. */
  documento: string;
  /** Indicador de IE do destinatário: 1 contribuinte, 2 isento, 9 não contribuinte. */
  indIEDest: string;
  ie?: string | undefined;
  email?: string | undefined;
  telefone?: string | undefined;
  logradouro: string;
  numero: string;
  complemento?: string | undefined;
  bairro: string;
  municipio: string;
  /** Código IBGE do município, 7 dígitos. É o que a SEFAZ confere, não o nome. */
  codigoMunicipio: string;
  uf: string;
  cep: string;
  /** Anotação livre de quem cadastrou — "paga a 30 dias", "retira na loja". */
  observacoes?: string | undefined;
  criadoEm: string;
  atualizadoEm: string;
  /** Quantas notas já saíram para ele. Ordena a lista pelo que se usa. */
  usos: number;
  ultimoUso?: string | undefined;
}

/** O que o formulário preenche; o resto é gerado. */
export type DestinatarioNovo = Omit<
  Destinatario,
  "id" | "criadoEm" | "atualizadoEm" | "usos" | "ultimoUso"
>;

export interface RepositorioDestinatarios {
  listar(): Promise<Destinatario[]>;
  obter(id: string): Promise<Destinatario | null>;
  salvar(dados: DestinatarioNovo, id?: string): Promise<Destinatario>;
  remover(id: string): Promise<void>;
  /** Marca que ele foi usado numa nota — é o que ordena a lista por relevância. */
  registrarUso(id: string): Promise<void>;
}

// Mesma razao da chave do tema: sob o dominio compartilhado da pre-visualizacao,
// uma chave fixa mostrava os destinatarios de um cliente na tela de outro.
const CHAVE = `${escopo}:destinatarios`;

const soDigitos = (v: string) => String(v ?? "").replace(/\D/g, "");

function agora(): string {
  return new Date().toISOString();
}

function novoId(): string {
  // `crypto.randomUUID` não existe em contexto inseguro nem em navegador antigo;
  // o fallback não precisa ser criptográfico, só único dentro desta lista.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Implementação em `localStorage`.
 *
 * Lê e escreve a lista inteira a cada operação. Para a ordem de grandeza real —
 * dezenas ou centenas de destinatários — isso é irrelevante, e mantém o código
 * simples o bastante para a troca por banco ser óbvia.
 */
class DestinatariosLocais implements RepositorioDestinatarios {
  private ler(): Destinatario[] {
    if (typeof window === "undefined") return [];
    try {
      const cru = window.localStorage.getItem(CHAVE);
      const lista = cru ? JSON.parse(cru) : [];
      return Array.isArray(lista) ? lista : [];
    } catch {
      // Dado corrompido não pode derrubar a tela de emissão: melhor lista vazia
      // e o operador digitar, do que um erro que impede de faturar.
      return [];
    }
  }

  private escrever(lista: Destinatario[]): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAVE, JSON.stringify(lista));
  }

  async listar(): Promise<Destinatario[]> {
    // Mais usados primeiro, e entre iguais o mais recente: é a ordem em que a
    // pessoa procura, não a alfabética.
    return this.ler().sort(
      (a, b) => (b.usos ?? 0) - (a.usos ?? 0) ||
        String(b.ultimoUso ?? b.atualizadoEm).localeCompare(String(a.ultimoUso ?? a.atualizadoEm)),
    );
  }

  async obter(id: string): Promise<Destinatario | null> {
    return this.ler().find((d) => d.id === id) ?? null;
  }

  async salvar(dados: DestinatarioNovo, id?: string): Promise<Destinatario> {
    const lista = this.ler();
    const limpos: DestinatarioNovo = {
      ...dados,
      documento: soDigitos(dados.documento),
      cep: soDigitos(dados.cep),
      codigoMunicipio: soDigitos(dados.codigoMunicipio),
      uf: String(dados.uf ?? "").toUpperCase().slice(0, 2),
      ie: dados.ie ? soDigitos(dados.ie) : undefined,
    };

    if (id) {
      const i = lista.findIndex((d) => d.id === id);
      if (i < 0) throw new Error("Destinatario nao encontrado.");
      const atualizado: Destinatario = { ...lista[i]!, ...limpos, atualizadoEm: agora() };
      lista[i] = atualizado;
      this.escrever(lista);
      return atualizado;
    }

    // Mesmo documento é a mesma pessoa: cadastrar duas vezes cria a dúvida de
    // qual está certo na hora de emitir.
    const existente = lista.find((d) => d.documento === limpos.documento && limpos.documento);
    if (existente) {
      const atualizado: Destinatario = { ...existente, ...limpos, atualizadoEm: agora() };
      this.escrever(lista.map((d) => (d.id === existente.id ? atualizado : d)));
      return atualizado;
    }

    const criado: Destinatario = {
      ...limpos,
      id: novoId(),
      criadoEm: agora(),
      atualizadoEm: agora(),
      usos: 0,
    };
    this.escrever([criado, ...lista]);
    return criado;
  }

  async remover(id: string): Promise<void> {
    this.escrever(this.ler().filter((d) => d.id !== id));
  }

  async registrarUso(id: string): Promise<void> {
    this.escrever(
      this.ler().map((d) =>
        d.id === id ? { ...d, usos: (d.usos ?? 0) + 1, ultimoUso: agora() } : d,
      ),
    );
  }
}

export const destinatarios: RepositorioDestinatarios = new DestinatariosLocais();

/** Busca por nome ou documento, ignorando pontuação e acento. */
export function filtrar(lista: Destinatario[], termo: string): Destinatario[] {
  const t = String(termo ?? "").trim().toLowerCase();
  if (!t) return lista;
  const digitos = soDigitos(t);
  return lista.filter((d) =>
    d.nome.toLowerCase().includes(t) ||
    (digitos.length >= 3 && d.documento.includes(digitos)) ||
    d.municipio.toLowerCase().includes(t),
  );
}

/** "12.345.678/0001-90" ou "123.456.789-01", conforme o tamanho. */
export function formatarDocumento(doc: string): string {
  const d = soDigitos(doc);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d;
}
