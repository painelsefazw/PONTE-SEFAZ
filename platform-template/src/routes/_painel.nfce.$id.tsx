import { createFileRoute, redirect } from "@tanstack/react-router";
import { PainelLayout } from "@/components/app/PainelLayout";
import { DocumentoDetalhe } from "@/components/app/DocumentoDetalhe";
import { tituloDaPagina, moduloAtivo } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/nfce/$id")({
  // Modulo nao contratado nao pode ser alcancado pela URL. Esconder do menu
  // resolve o caminho normal; o link salvo nos favoritos, nao.
  beforeLoad: () => {
    if (!moduloAtivo("nfce")) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: tituloDaPagina("Detalhes do cupom") },
      { name: "description", content: "Detalhes e cancelamento do cupom fiscal." },
      { property: "og:title", content: tituloDaPagina("Detalhes do cupom") },
      { property: "og:description", content: "Consulte e cancele uma NFC-e emitida." },
    ],
  }),
  component: DetalheNfce,
});

function DetalheNfce() {
  const { id } = Route.useParams();
  return (
    <PainelLayout title="Detalhes do cupom" description={`Documento ${id}`}>
      <DocumentoDetalhe tipo="nfce" id={id} />
    </PainelLayout>
  );
}
