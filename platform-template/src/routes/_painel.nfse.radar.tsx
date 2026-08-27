import { createFileRoute, redirect } from "@tanstack/react-router";
import { PainelLayout } from "@/components/app/PainelLayout";
import { RadarRecebidas } from "@/components/app/RadarRecebidas";
import { marca, tituloDaPagina, moduloAtivo } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/nfse/radar")({
  // Segue o modulo de NFS-e: quem nao contratou servico nao tem nota de servico
  // para receber. Esconder do menu resolve o caminho normal; o link salvo nos
  // favoritos, nao.
  beforeLoad: () => {
    if (!moduloAtivo("nfse")) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: tituloDaPagina("Notas recebidas") },
      { name: "description", content: "NFS-e recebidas de fornecedores, baixadas do Ambiente Nacional." },
      { property: "og:title", content: tituloDaPagina("Notas recebidas") },
      {
        property: "og:description",
        content: `NFS-e que a ${marca} recebeu, com o XML pronto para a contabilidade.`,
      },
    ],
  }),
  component: () => (
    <PainelLayout
      title="Notas recebidas"
      description="NFS-e emitidas contra a empresa, direto do Ambiente Nacional"
    >
      <RadarRecebidas />
    </PainelLayout>
  ),
});
