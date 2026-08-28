import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { PainelLayout } from "@/components/app/PainelLayout";
import { ClientesLista } from "@/components/app/ClientesLista";
import { Button } from "@/components/ui/button";
import { tituloDaPagina } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/clientes/")({
  head: () => ({
    meta: [
      { title: tituloDaPagina("Clientes") },
      { name: "description", content: "Empresas que emitem pela ponte fiscal." },
    ],
  }),
  component: () => (
    <PainelLayout
      title="Clientes"
      description="Empresas que emitem documentos fiscais pela sua ponte."
      actions={
        <Button asChild size="sm">
          <Link to="/clientes/novo">
            <Plus className="size-4" /> Novo cliente
          </Link>
        </Button>
      }
    >
      <ClientesLista />
    </PainelLayout>
  ),
});
