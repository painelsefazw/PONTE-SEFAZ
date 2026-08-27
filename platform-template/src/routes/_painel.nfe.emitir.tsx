import { createFileRoute, redirect } from "@tanstack/react-router";
import { PainelLayout } from "@/components/app/PainelLayout";
import { EmissaoForm } from "@/components/app/EmissaoForm";
import { tituloDaPagina, moduloAtivo } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/nfe/emitir")({
  // Modulo nao contratado nao pode ser alcancado pela URL. Esconder do menu
  // resolve o caminho normal; o link salvo nos favoritos, nao.
  beforeLoad: () => {
    if (!moduloAtivo("nfe")) throw redirect({ to: "/dashboard" });
  },
  /**
   * `?de=<chave>` traz os dados de uma nota anterior.
   *
   * Vai na URL, e nao em estado de navegacao, porque assim o link funciona
   * copiado, colado e recarregado — e "reaproveitar aquela nota" e exatamente o
   * tipo de coisa que a pessoa faz de novo no dia seguinte.
   */
  // O tipo de retorno declara `de` OPCIONAL. Sem isso o TanStack passa a exigir
  // `search` em todo link que aponte para esta rota — e havia tres deles, que
  // nao tem nota nenhuma para reaproveitar.
  validateSearch: (busca: Record<string, unknown>): { de?: string } =>
    typeof busca["de"] === "string" && busca["de"] ? { de: busca["de"] } : {},
  head: () => ({
    meta: [
      { title: tituloDaPagina("Emitir NF-e") },
      { name: "description", content: "Emita uma nova nota fiscal eletronica de produto." },
      { property: "og:title", content: tituloDaPagina("Emitir NF-e") },
      { property: "og:description", content: "Formulario de emissao de NF-e." },
    ],
  }),
  component: EmitirNfe,
});

function EmitirNfe() {
  const { de } = Route.useSearch();
  return (
    <PainelLayout
      title="Emitir NF-e"
      description={de ? "Dados trazidos de uma nota anterior" : "Preencha os dados da nota fiscal"}
    >
      <EmissaoForm tipo="nfe" duplicarDe={de} />
    </PainelLayout>
  );
}
