import { useEffect, useState } from "react";
import { Search, UserPlus, Users, X } from "lucide-react";
import {
  destinatarios,
  filtrar,
  formatarDocumento,
  type Destinatario,
} from "@/lib/cadastros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Escolher um destinatário já cadastrado, em vez de redigitá-lo.
 *
 * Emitir a segunda nota para o mesmo cliente pedia nove campos que já estavam na
 * primeira — e errar um deles volta como rejeição da SEFAZ, depois de a nota ter
 * sido montada e transmitida.
 *
 * A lista vem ordenada por uso, não por nome: quem emite procura o cliente de
 * sempre, e ele deve estar no topo sem precisar buscar.
 */
export function SeletorDestinatario({
  aberto,
  onFechar,
  onEscolher,
}: {
  aberto: boolean;
  onFechar: () => void;
  onEscolher: (d: Destinatario) => void;
}) {
  const [lista, setLista] = useState<Destinatario[]>([]);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!aberto) return;
    setCarregando(true);
    destinatarios
      .listar()
      .then(setLista)
      .catch(() => setLista([]))
      .finally(() => setCarregando(false));
  }, [aberto]);

  if (!aberto) return null;

  const filtrados = filtrar(lista, busca);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      onClick={onFechar}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-xl border border-border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4" /> Destinatarios cadastrados
          </h2>
          <button type="button" onClick={onFechar} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="border-b border-border p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-9"
              placeholder="Nome, CPF/CNPJ ou municipio"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {carregando ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Carregando...</p>
          ) : filtrados.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-muted-foreground">
                {lista.length === 0
                  ? "Nenhum destinatario cadastrado ainda."
                  : "Nada encontrado para essa busca."}
              </p>
              {lista.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Preencha os dados na nota e use <strong>Salvar destinatario</strong> —
                  na proxima vez ele aparece aqui.
                </p>
              )}
            </div>
          ) : (
            filtrados.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => { onEscolher(d); onFechar(); }}
                className="flex w-full items-start gap-3 rounded-lg p-3 text-left transition hover:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.nome}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatarDocumento(d.documento)} · {d.municipio}/{d.uf}
                    {d.ie ? ` · IE ${d.ie}` : ""}
                  </div>
                </div>
                {d.usos > 0 && (
                  <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {d.usos} nota{d.usos > 1 ? "s" : ""}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Guarda o destinatário que está na tela, para a próxima nota.
 *
 * Fica ao lado do formulário e não numa tela separada: o momento em que se tem
 * os dados corretos na mão é agora, depois de conferi-los para emitir.
 */
export function BotaoSalvarDestinatario({
  dados,
  onSalvo,
}: {
  dados: {
    nome: string; documento: string; tipo: string; ie: string; email: string;
    logradouro: string; numero: string; bairro: string; municipio: string;
    codigoMunicipio: string; uf: string; cep: string;
  };
  onSalvo?: (d: Destinatario) => void;
}) {
  const [estado, setEstado] = useState<"parado" | "salvando" | "salvo">("parado");

  const completo =
    dados.nome.trim() && dados.documento.trim() && dados.logradouro.trim() &&
    dados.municipio.trim() && dados.uf.trim();

  async function salvar() {
    setEstado("salvando");
    try {
      const doc = dados.documento.replace(/\D/g, "");
      const d = await destinatarios.salvar({
        tipo: doc.length === 11 ? "pf" : "pj",
        nome: dados.nome.trim(),
        documento: doc,
        indIEDest: dados.tipo || "9",
        ie: dados.ie || undefined,
        email: dados.email || undefined,
        logradouro: dados.logradouro.trim(),
        numero: dados.numero || "S/N",
        bairro: dados.bairro.trim(),
        municipio: dados.municipio.trim(),
        codigoMunicipio: dados.codigoMunicipio,
        uf: dados.uf,
        cep: dados.cep,
      });
      setEstado("salvo");
      onSalvo?.(d);
      // Volta ao normal para poder salvar de novo se o operador corrigir algo.
      setTimeout(() => setEstado("parado"), 2500);
    } catch {
      setEstado("parado");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!completo || estado === "salvando"}
      onClick={salvar}
      title={completo ? "Guardar para as proximas notas" : "Preencha nome, documento e endereco"}
    >
      <UserPlus className="size-4" />
      {estado === "salvo" ? "Salvo" : "Salvar destinatario"}
    </Button>
  );
}
