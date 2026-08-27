import { createFileRoute, redirect } from "@tanstack/react-router";
import { PainelLayout } from "@/components/app/PainelLayout";
import { DocumentoDetalhe } from "@/components/app/DocumentoDetalhe";
import { tituloDaPagina, moduloAtivo } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/nfse/$id")({
  // Modulo nao contratado nao pode ser alcancado pela URL. Esconder do menu
  // resolve o caminho normal; o link salvo nos favoritos, nao.
  beforeLoad: () => {
    if (!moduloAtivo("nfse")) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: tituloDaPagina("Detalhes da NFS-e") },
      { name: "description", content: "Detalhes e cancelamento da nota fiscal de servico." },
      { property: "og:title", content: tituloDaPagina("Detalhes da NFS-e") },
      { property: "og:description", content: "Consulte e cancele uma NFS-e emitida." },
    ],
  }),
  component: DetalheNfse,
});

function DetalheNfse() {
  const { id } = Route.useParams();
  return (
    <PainelLayout title="Detalhes da NFS-e" description={`Documento ${id}`}>
      <DocumentoDetalhe tipo="nfse" id={id} />
    </PainelLayout>
  );
}
