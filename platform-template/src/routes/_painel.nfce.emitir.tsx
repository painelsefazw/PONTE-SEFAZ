import { createFileRoute, redirect } from "@tanstack/react-router";
import { PainelLayout } from "@/components/app/PainelLayout";
import { EmissaoForm } from "@/components/app/EmissaoForm";
import { tituloDaPagina, moduloAtivo } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/nfce/emitir")({
  // Modulo nao contratado nao pode ser alcancado pela URL. Esconder do menu
  // resolve o caminho normal; o link salvo nos favoritos, nao.
  beforeLoad: () => {
    if (!moduloAtivo("nfce")) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: tituloDaPagina("Vender") },
      { name: "description", content: "Emissao de cupom fiscal no balcao." },
      { property: "og:title", content: tituloDaPagina("Vender") },
      { property: "og:description", content: "Venda de balcao com emissao de NFC-e." },
    ],
  }),
  component: () => (
    // "Venda" e nao "Emitir NFC-e": quem esta no caixa esta vendendo, e o cupom
    // e consequencia. O nome fiscal fica no titulo da aba, para quem procura.
    <PainelLayout title="Venda" description="Cupom fiscal do balcao">
      <EmissaoForm tipo="nfce" />
    </PainelLayout>
  ),
});
