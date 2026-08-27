import { createFileRoute, redirect } from "@tanstack/react-router";
import { PainelLayout } from "@/components/app/PainelLayout";
import { ComprasRecebidas } from "@/components/app/ComprasRecebidas";
import { marca, tituloDaPagina, moduloAtivo } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/nfe/compras")({
  // Segue o modulo de NF-e: nota de mercadoria recebida so interessa a quem
  // trabalha com mercadoria. Esconder do menu resolve o caminho normal; o link
  // salvo nos favoritos, nao.
  beforeLoad: () => {
    if (!moduloAtivo("nfe")) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: tituloDaPagina("Compras") },
      { name: "description", content: "NF-e emitidas por fornecedores contra a empresa, direto da SEFAZ." },
      { property: "og:title", content: tituloDaPagina("Compras") },
      {
        property: "og:description",
        content: `NF-e que a ${marca} recebeu de fornecedores, com manifestacao e XML.`,
      },
    ],
  }),
  component: () => (
    <PainelLayout
      title="Compras"
      description="NF-e emitidas contra a empresa, direto da SEFAZ"
    >
      <ComprasRecebidas />
    </PainelLayout>
  ),
});
