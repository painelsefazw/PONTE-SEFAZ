import { createFileRoute, redirect } from "@tanstack/react-router";
import { PainelLayout } from "@/components/app/PainelLayout";
import { EmissaoForm } from "@/components/app/EmissaoForm";
import { tituloDaPagina, moduloAtivo } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/nfse/emitir")({
  // Modulo nao contratado nao pode ser alcancado pela URL. Esconder do menu
  // resolve o caminho normal; o link salvo nos favoritos, nao.
  beforeLoad: () => {
    if (!moduloAtivo("nfse")) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: tituloDaPagina("Emitir NFS-e") },
      { name: "description", content: "Emita uma nova nota fiscal de servico eletronica." },
      { property: "og:title", content: tituloDaPagina("Emitir NFS-e") },
      { property: "og:description", content: "Formulario de emissao de NFS-e." },
    ],
  }),
  component: () => (
    <PainelLayout title="Emitir NFS-e" description="Preencha os dados do servico">
      <EmissaoForm tipo="nfse" />
    </PainelLayout>
  ),
});
