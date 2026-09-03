import { createFileRoute } from "@tanstack/react-router";
import { PainelLayout } from "@/components/app/PainelLayout";
import { formatCnpj, manifest, tituloDaPagina } from "@/lib/manifest";
import { Selo } from "@/components/app/states";

export const Route = createFileRoute("/_painel/configuracoes")({
  head: () => ({
    meta: [
      { title: tituloDaPagina("Configuracoes") },
      { name: "description", content: "Dados da empresa, modulos fiscais e integracao ativa." },
      { property: "og:title", content: tituloDaPagina("Configuracoes") },
      { property: "og:description", content: "Dados cadastrais e modulos habilitados na plataforma." },
    ],
  }),
  component: Configuracoes,
});

function Configuracoes() {
  const dados: Array<[string, string]> = [
    ["Razao social", manifest.company.name],
    ["Nome fantasia", manifest.company.tradeName?.trim() || "—"],
    ["Marca da plataforma", manifest.company.brandName],
    ["CNPJ", formatCnpj(manifest.company.cnpj)],
    ["Codigo do cliente", manifest.company.id],
    ["Template", `${manifest.project.template} v${manifest.project.templateVersion}`],
  ];

  const modulos = [
    { nome: "NF-e", ativo: manifest.modules.nfe },
    { nome: "NFS-e", ativo: manifest.modules.nfse },
  ];

  return (
    <PainelLayout title="Configuracoes" description="Dados da empresa e modulos">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Empresa</h2>
          <dl className="mt-4 space-y-4">
            {dados.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Modulos habilitados</h2>
          <ul className="mt-4 space-y-3">
            {modulos.map((m) => (
              <li
                key={m.nome}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
              >
                <span className="text-sm font-medium">{m.nome}</span>
                {/* Era uma copia manual do selo, com `text-success-foreground`
                    — a cor de fundo SOLIDO — sobre fundo a 15%. No modo escuro
                    dava texto quase preto sobre fundo quase preto. */}
                <Selo tom="sucesso">Ativo</Selo>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-muted-foreground">
            As credenciais de integracao ficam armazenadas com seguranca no servidor e nunca sao
            expostas no navegador.
          </p>
        </section>
      </div>
    </PainelLayout>
  );
}
