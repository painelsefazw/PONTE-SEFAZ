import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PainelLayout } from "@/components/app/PainelLayout";
import { inutilizarNumeracao } from "@/lib/fiscal.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { tituloDaPagina, moduloAtivo } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/nfe/inutilizar")({
  // Modulo nao contratado nao pode ser alcancado pela URL. Esconder do menu
  // resolve o caminho normal; o link salvo nos favoritos, nao.
  beforeLoad: () => {
    if (!moduloAtivo("nfe")) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: tituloDaPagina("Inutilizar numeracao") },
      { name: "description", content: "Inutilize faixas de numeracao de NF-e junto a SEFAZ." },
      { property: "og:title", content: tituloDaPagina("Inutilizar numeracao") },
      { property: "og:description", content: "Inutilizacao de faixas de numeracao de NF-e." },
    ],
  }),
  component: Inutilizar,
});

function Inutilizar() {
  const inutilizar = useServerFn(inutilizarNumeracao);
  const [form, setForm] = useState({
    serie: "",
    numeroInicial: "",
    numeroFinal: "",
    justificativa: "",
    // A numeracao e contada por ambiente. Sem este campo a chamada caia no
    // ambiente do CADASTRO da empresa: quem quisesse limpar uma faixa de teste
    // queimava numeros de producao — e o inverso deixava a faixa de teste suja.
    ambiente: "1" as "1" | "2",
  });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.justificativa.trim().length < 15) {
      setErro("A justificativa deve ter ao menos 15 caracteres.");
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const res = await inutilizar({ data: form });
      if (res.ok) {
        toast.success("Inutilizacao enviada com sucesso.");
        setForm((f) => ({ serie: "", numeroInicial: "", numeroFinal: "", justificativa: "", ambiente: f.ambiente }));
      } else {
        setErro(res.error);
      }
    } catch {
      setErro("Nao foi possivel enviar a inutilizacao.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <PainelLayout title="Inutilizar numeracao" description="NF-e nao utilizadas">
      <form
        onSubmit={onSubmit}
        className="max-w-2xl space-y-5 rounded-xl border border-border bg-card p-6"
      >
        {/* A numeração é contada por ambiente, e inutilizar é irreversível: sem
            escolher aqui, a tela queimaria números do ambiente errado. */}
        <div className="space-y-2">
          <Label htmlFor="ambiente">Ambiente</Label>
          <select
            id="ambiente"
            value={form.ambiente}
            onChange={(e) => setForm({ ...form, ambiente: e.target.value as "1" | "2" })}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="1">Producao — numeracao real</option>
            <option value="2">Homologacao — numeracao de teste</option>
          </select>
          <p className="text-xs text-muted-foreground">
            A faixa some so no ambiente escolhido. Inutilizar nao tem volta.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="serie">Serie</Label>
            <Input
              id="serie"
              required
              value={form.serie}
              onChange={(e) => setForm({ ...form, serie: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="numeroInicial">Numero inicial</Label>
            <Input
              id="numeroInicial"
              required
              value={form.numeroInicial}
              onChange={(e) => setForm({ ...form, numeroInicial: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="numeroFinal">Numero final</Label>
            <Input
              id="numeroFinal"
              required
              value={form.numeroFinal}
              onChange={(e) => setForm({ ...form, numeroFinal: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="justificativa">Justificativa</Label>
          <Textarea
            id="justificativa"
            rows={4}
            value={form.justificativa}
            onChange={(e) => setForm({ ...form, justificativa: e.target.value })}
          />
        </div>
        {erro && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>
        )}
        <Button type="submit" disabled={enviando}>
          {enviando && <Loader2 className="size-4 animate-spin" />}
          Enviar inutilizacao
        </Button>
      </form>
    </PainelLayout>
  );
}
