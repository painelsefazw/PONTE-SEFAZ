import { createFileRoute } from "@tanstack/react-router";
import { Mail, MessageCircle } from "lucide-react";
import { PainelLayout } from "@/components/app/PainelLayout";
import { manifest, tituloDaPagina, whatsappDoSuporte } from "@/lib/manifest";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_painel/suporte")({
  head: () => ({
    meta: [
      { title: tituloDaPagina("Suporte") },
      { name: "description", content: "Fale com o suporte tecnico da plataforma fiscal." },
      { property: "og:title", content: tituloDaPagina("Suporte") },
      { property: "og:description", content: "Canais de atendimento da plataforma fiscal." },
    ],
  }),
  component: Suporte,
});

/** "5538988887777" -> "+55 (38) 98888-7777". Numero cru cansa de ler. */
function formatarTelefone(digitos: string): string {
  const d = digitos.replace(/\D/g, "");
  const m = /^(\d{2})(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+${m[1]} (${m[2]}) ${m[3]}-${m[4]}` : digitos;
}

function Suporte() {
  // Sem numero cadastrado — ou com um numero que nao da para completar com
  // seguranca — o cartao inteiro nao aparece, em vez de um botao que abre o
  // WhatsApp em lugar nenhum. O DDI entra aqui: o cadastro guarda o que a
  // pessoa digitou, e digitar sem o 55 e o normal.
  const whatsapp = whatsappDoSuporte() ?? "";

  return (
    <PainelLayout title="Suporte" description="Estamos aqui para ajudar">
      <div className="max-w-xl space-y-6">
        {/* O WhatsApp vem PRIMEIRO quando existe: quem está com a nota travada
            no meio de uma venda não espera "até 1 dia útil". */}
        {whatsapp && (
          <section className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-success/15 text-success-tint">
                <MessageCircle className="size-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Suporte por WhatsApp</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Para nota travada ou rejeicao no meio de uma venda. Resposta em horario comercial.
                </p>
                <p className="mt-3 text-sm font-medium">{formatarTelefone(whatsapp)}</p>
                <Button asChild className="mt-4" size="sm">
                  {/* A mensagem já vai montada: o operador não precisa explicar
                      de onde veio, e a gente sabe qual plataforma abriu. */}
                  <a
                    href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(
                      `Ola! Preciso de ajuda com a plataforma fiscal ${manifest.company.brandName}.`,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="size-4" /> Chamar no WhatsApp
                  </a>
                </Button>
              </div>
            </div>
          </section>
        )}

        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <Mail className="size-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Suporte por e-mail</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Envie sua duvida ou ocorrencia e responderemos em ate 1 dia util.
              </p>
              <p className="mt-3 break-all text-sm font-medium">{manifest.support.email}</p>
              <Button asChild variant={whatsapp ? "outline" : "default"} className="mt-4" size="sm">
                <a href={`mailto:${manifest.support.email}`}>Enviar e-mail</a>
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Ao abrir um chamado</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Informe o tipo de documento (NF-e ou NFS-e).</li>
            <li>Inclua o numero, serie ou chave de acesso.</li>
            <li>Descreva a mensagem de erro exibida.</li>
          </ul>
        </section>
      </div>
    </PainelLayout>
  );
}
