import type { WhiteLabelConfig } from './white-label';

/**
 * A personalizacao de um cliente, escrita para o chat do construtor.
 *
 * O manifest ja leva tudo isto em JSON, e o template le o JSON. So que o
 * construtor (Lovable) NAO le o manifest: ele responde ao que se escreve no
 * chat dele. Entao a marca cadastrada aqui chegava ate o repositorio e parava
 * ali — o site nascia com as cores do modelo, e a impressao era de que o
 * cadastro de marca nao servia para nada.
 *
 * Este documento fecha esse vao. Ele nao resume: escreve cada valor como esta
 * gravado, um por linha, com o nome do campo ao lado. Resumo aqui seria o mesmo
 * defeito de novo — o construtor preencheria as lacunas por conta propria, e o
 * cliente receberia uma cor que ninguem escolheu.
 */

export interface DadosDaPersonalizacao {
  cnpj: string;
  razaoSocial: string;
  fantasia?: string | undefined;
  uf?: string | undefined;
  modulos: string[];
  apiBaseUrl: string;
  marca: WhiteLabelConfig;
  geradoEm?: Date;
}

/** `—` em vez de vazio: linha em branco numa tabela parece campo esquecido. */
function ou(valor: string | undefined | null, vazio = '— (não preenchido)'): string {
  const v = String(valor ?? '').trim();
  return v || vazio;
}

function linhaDeCor(rotulo: string, token: string, valor: string): string {
  return `| ${rotulo} | \`${token}\` | \`${valor}\` |`;
}

/**
 * Imagem entra como PONTEIRO, nunca como base64.
 *
 * A logo de um cliente passa fácil de 100 KB em data URI. Colada num chat ela
 * estoura o limite da mensagem, e o que chega do outro lado é um data URI
 * cortado — que renderiza como imagem quebrada, sem erro nenhum. O arquivo do
 * repositório já tem o valor inteiro; o caminho até ele é o que precisa ser
 * dito.
 */
function descreverImagem(nome: string, valor: string | undefined, caminho: string): string {
  const v = String(valor ?? '').trim();
  if (!v) return `- **${nome}**: não enviado. Não invente um — deixe o espaço vazio.`;
  const tamanho = Math.round((v.length * 3) / 4 / 1024);
  return `- **${nome}**: já está no repositório, em \`src/platform.manifest.json\` → \`${caminho}\`, `
    + `como data URI (~${tamanho} KB). Leia de lá. Não peça para eu colar aqui: `
    + `data URI colado em chat chega cortado e vira imagem quebrada sem erro nenhum.`;
}

export function gerarPersonalizacaoMd(d: DadosDaPersonalizacao): string {
  const m = d.marca;
  const quando = (d.geradoEm ?? new Date()).toISOString().slice(0, 16).replace('T', ' ');
  const nome = m.nomePlataforma || d.fantasia || d.razaoSocial;
  const cnpjFmt = d.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

  return `# Personalização da plataforma — ${d.razaoSocial}

> Documento gerado pelo painel em ${quando} (UTC). Cole INTEIRO no chat do construtor.
> Ele descreve a identidade desta empresa, campo por campo, sem resumir.
> Onde estiver escrito \`— (não preenchido)\`, mantenha o padrão do modelo e
> **não invente** um valor.

## 1. De quem é esta plataforma

| Campo | Valor |
| --- | --- |
| Razão social | ${ou(d.razaoSocial)} |
| Nome fantasia | ${ou(d.fantasia)} |
| CNPJ | \`${cnpjFmt}\` |
| UF do emitente | ${ou(d.uf)} |
| Nome da plataforma (aparece no topo e no login) | **${ou(nome)}** |
| Nome de exibição (quando diferente do acima) | ${ou(m.nomeExibicao)} |

## 2. Cores — use exatamente estes valores

Aplique como tokens do tema. Não aproxime, não gere variações "harmônicas" e não
troque por cores de paleta. Estes hexadecimais foram escolhidos para esta empresa.

| Papel | Token | Valor |
| --- | --- | --- |
${linhaDeCor('Primária (ações, links, marca)', 'primary', m.corPrimaria)}
${linhaDeCor('Secundária (barras, cabeçalhos)', 'secondary', m.corSecundaria)}
${linhaDeCor('Destaque (avisos, selos)', 'accent', m.corDestaque)}
${linhaDeCor('Fundo da página', 'background', m.corBackground)}
${linhaDeCor('Superfície (cartões, modais)', 'surface', m.corSurface)}
${linhaDeCor('Texto principal', 'text', m.corTexto)}
${linhaDeCor('Texto secundário', 'muted', m.corMuted)}
${m.corBorda ? linhaDeCor('Borda', 'border', m.corBorda) : '| Borda | `border` | — (não preenchido: derive do texto secundário) |'}

- **Tema**: \`${m.tema}\`${m.tema === 'auto' ? ' (segue o sistema do visitante)' : ''}
- **Raio de canto**: ${ou(m.borderRadius, '— (não preenchido: mantenha o do modelo)')}

## 3. Logo e favicon

${descreverImagem('Logo principal', m.logoBase64, 'assets.logo')}
${descreverImagem('Logo para fundo escuro', m.logoDarkBase64, 'assets.logoDark')}
${descreverImagem('Favicon', m.faviconBase64, 'assets.favicon')}

## 4. Textos da interface

| Onde aparece | Texto |
| --- | --- |
| Título da aba do navegador | ${ou(m.tituloNavegador)} |
| Mensagem na tela de login | ${ou(m.mensagemLogin)} |
| Rodapé | ${ou(m.rodape)} |

## 5. Suporte e páginas legais

| Campo | Valor |
| --- | --- |
| E-mail de suporte | ${ou(m.suporteEmail)} |
| Telefone | ${ou(m.suporteTelefone)} |
| WhatsApp | ${ou(m.suporteWhatsapp)} |
| Site | ${ou(m.suporteSite)} |
| Termos de uso (URL) | ${ou(m.termosUrl)} |
| Política de privacidade (URL) | ${ou(m.privacidadeUrl)} |
| Domínio de produção | ${ou(m.dominioProducao)} |

Links legais em branco: **não crie páginas** de termos ou privacidade. Esconda o
item do rodapé. Uma página inventada dá ao cliente um texto jurídico que ele
nunca escreveu, e ele só descobre quando alguém cobrar.

## 6. Documentos que esta empresa emite

${d.modulos.length
    ? d.modulos.map((s) => `- ${s.toUpperCase()}`).join('\n')
    : '- Nenhum serviço ativo. Não monte tela de emissão.'}

Mostre **somente** estes. Uma aba de documento não contratado leva o cliente a
preencher uma nota inteira para receber "serviço não contratado" no fim.

## 7. Conexão com a ponte

- Endereço da API: \`${d.apiBaseUrl}\`
- Ele vem de \`src/platform.manifest.json\` → \`api.baseUrl\`, e é lido em
  \`src/lib/fiscal.server.ts\`. **Não escreva endereço de API no código.**
- As credenciais (\`FISCAL_API_KEY\`, \`APP_ACCESS_PASSWORD\`) vivem só nos
  secrets do servidor. Nunca com prefixo \`VITE_\`: o que leva esse prefixo vai
  para o navegador, e essa chave emite nota fiscal em nome da empresa.

## 8. O que NÃO fazer

- Não troque a estrutura de telas nem os nomes das rotas: a ponte responde a
  caminhos fixos, e renomear quebra a emissão.
- Não altere \`src/platform.manifest.json\` à mão. Ele é gerado pelo painel, e
  edição manual volta atrás no próximo \`git pull\`.
- Não substitua nenhuma cor acima por "algo parecido, mais bonito".
- Não adicione telas de cadastro de usuário: o acesso é por CNPJ e senha única.
`;
}
