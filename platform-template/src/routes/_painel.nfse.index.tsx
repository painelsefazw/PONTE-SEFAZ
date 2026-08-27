import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { PainelLayout } from "@/components/app/PainelLayout";
import { DocumentosLista } from "@/components/app/DocumentosLista";
import { Button } from "@/components/ui/button";
import { marca, tituloDaPagina, moduloAtivo } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/nfse/")({
  // Modulo nao contratado nao pode ser alcancado pela URL. Esconder do menu
  // resolve o caminho normal; o link salvo nos favoritos, nao.
  beforeLoad: () => {
    if (!moduloAtivo("nfse")) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: tituloDaPagina("NFS-e") },
      { name: "description", content: "Lista de notas fiscais de servico eletronicas emitidas." },
      { property: "og:title", content: tituloDaPagina("NFS-e") },
      { property: "og:description", content: `Consulte as NFS-e emitidas pela ${marca}.` },
    ],
  }),
  component: () => (
    <PainelLayout
      title="NFS-e"
      description="Notas fiscais de servico"
      actions={
        <Button asChild size="sm">
          <Link to="/nfse/emitir">
            <Plus className="size-4" /> Emitir
          </Link>
        </Button>
      }
    >
      <DocumentosLista tipo="nfse" />
    </PainelLayout>
  ),
});
