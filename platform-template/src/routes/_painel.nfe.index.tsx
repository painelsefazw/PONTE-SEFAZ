import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Plus, Ban } from "lucide-react";
import { PainelLayout } from "@/components/app/PainelLayout";
import { DocumentosLista } from "@/components/app/DocumentosLista";
import { Button } from "@/components/ui/button";
import { marca, tituloDaPagina, moduloAtivo } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/nfe/")({
  // Modulo nao contratado nao pode ser alcancado pela URL. Esconder do menu
  // resolve o caminho normal; o link salvo nos favoritos, nao.
  beforeLoad: () => {
    if (!moduloAtivo("nfe")) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: tituloDaPagina("NF-e") },
      { name: "description", content: "Lista de notas fiscais eletronicas emitidas." },
      { property: "og:title", content: tituloDaPagina("NF-e") },
      { property: "og:description", content: `Consulte as NF-e emitidas pela ${marca}.` },
    ],
  }),
  component: () => (
    <PainelLayout
      title="NF-e"
      description="Notas fiscais eletronicas"
      actions={
        <>
          <Button asChild variant="outline" size="sm">
            <Link to="/nfe/inutilizar">
              <Ban className="size-4" /> <span className="hidden sm:inline">Inutilizar</span>
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/nfe/emitir">
              <Plus className="size-4" /> Emitir
            </Link>
          </Button>
        </>
      }
    >
      <DocumentosLista tipo="nfe" />
    </PainelLayout>
  ),
});
