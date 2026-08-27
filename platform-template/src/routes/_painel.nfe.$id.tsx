import { createFileRoute, redirect } from "@tanstack/react-router";
import { PainelLayout } from "@/components/app/PainelLayout";
import { DocumentoDetalhe } from "@/components/app/DocumentoDetalhe";
import { tituloDaPagina, moduloAtivo } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/nfe/$id")({
  // Modulo nao contratado nao pode ser alcancado pela URL. Esconder do menu
  // resolve o caminho normal; o link salvo nos favoritos, nao.
  beforeLoad: () => {
    if (!moduloAtivo("nfe")) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: tituloDaPagina("Detalhes da NF-e") },
      { name: "description", content: "Detalhes e cancelamento da nota fiscal eletronica." },
      { property: "og:title", content: tituloDaPagina("Detalhes da NF-e") },
      { property: "og:description", content: "Consulte e cancele uma NF-e emitida." },
    ],
  }),
  component: DetalheNfe,
});

function DetalheNfe() {
  const { id } = Route.useParams();
  return (
    <PainelLayout title="Detalhes da NF-e" description={`Documento ${id}`}>
      <DocumentoDetalhe tipo="nfe" id={id} />
    </PainelLayout>
  );
}
