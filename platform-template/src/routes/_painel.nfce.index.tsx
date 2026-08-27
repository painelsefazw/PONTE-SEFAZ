import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { PainelLayout } from "@/components/app/PainelLayout";
import { DocumentosLista } from "@/components/app/DocumentosLista";
import { Button } from "@/components/ui/button";
import { marca, tituloDaPagina, moduloAtivo } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/nfce/")({
  // Modulo nao contratado nao pode ser alcancado pela URL. Esconder do menu
  // resolve o caminho normal; o link salvo nos favoritos, nao.
  beforeLoad: () => {
    if (!moduloAtivo("nfce")) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: tituloDaPagina("NFC-e") },
      { name: "description", content: "Cupons fiscais eletronicos emitidos no balcao." },
      { property: "og:title", content: tituloDaPagina("NFC-e") },
      { property: "og:description", content: `Consulte os cupons emitidos pela ${marca}.` },
    ],
  }),
  component: () => (
    <PainelLayout
      title="NFC-e"
      description="Cupons fiscais do balcao"
      actions={
        // Sem "Inutilizar" aqui, ao contrario da NF-e: no balcao a numeracao e
        // consumida em rajada pela propria API, e inutilizar faixa e operacao de
        // quem controla a numeracao na mao.
        <Button asChild size="sm">
          <Link to="/nfce/emitir">
            <Plus className="size-4" /> Vender
          </Link>
        </Button>
      }
    >
      <DocumentosLista tipo="nfce" />
    </PainelLayout>
  ),
});
