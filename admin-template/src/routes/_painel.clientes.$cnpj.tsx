import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PainelLayout } from "@/components/app/PainelLayout";
import { ClienteDetalhe } from "@/components/app/ClienteDetalhe";
import { Button } from "@/components/ui/button";
import { tituloDaPagina } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/clientes/$cnpj")({
  head: () => ({
    meta: [{ title: tituloDaPagina("Cliente") }],
  }),
  component: Detalhe,
});

function Detalhe() {
  const { cnpj } = Route.useParams();
  return (
    <PainelLayout
      title="Cliente"
      description="Cadastro, serviços, chaves e plataforma."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/clientes">
            <ArrowLeft className="size-4" /> Voltar
          </Link>
        </Button>
      }
    >
      <ClienteDetalhe cnpj={cnpj} />
    </PainelLayout>
  );
}
