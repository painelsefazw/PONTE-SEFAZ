# Plataforma Fiscal — modelo

Este é o **modelo único** das plataformas white-label. Todo cliente roda este
mesmo código; o que muda de um para outro é **um arquivo**:
`src/platform.manifest.json`.

> Antes, cada cliente era gerado do zero por IA a partir de uma especificação de
> 40 mil caracteres. Isso custava os créditos do construtor inteiros por cliente,
> e produzia um sistema **diferente** a cada vez — então correção feita para um
> cliente nunca chegava aos outros. Aqui o código é o mesmo para todos, e
> correção vira um `git pull` do modelo.

## Como nasce a plataforma de um cliente

1. No painel do Emissor: **Clientes API → o cliente → Gerar plataforma**.
   Ele devolve o `platform.manifest.json` e as credenciais.
2. Crie o repositório do cliente a partir deste modelo (ou receba o `.zip`
   pronto do painel).
3. Substitua `src/platform.manifest.json` pelo do cliente. **Só isso.**
4. Conecte o repositório ao projeto do construtor e publique.
5. Cadastre as variáveis de ambiente (abaixo) no provedor. **Nenhuma delas vai
   para o repositório.**

## O manifest

`src/platform.manifest.json` carrega marca, cores, CNPJ, UF, módulos contratados,
contatos de suporte e textos da interface. `src/lib/manifest.ts` lê esse arquivo,
tipa e aplica:

- **Cores** viram CSS inline no `<head>`, antes da primeira pintura. As cores de
  marca (primária, secundária, destaque) valem nos dois temas; fundo, texto e
  borda só no tema claro — a paleta escura foi desenhada para ser escura, e
  deixar um fundo claro vencer ali produz texto ilegível para quem usa o tema
  escuro.
- **Títulos e meta tags** das 13 telas saem de `tituloDaPagina()`. Nenhuma tela
  tem o nome do cliente escrito no código.
- **Chaves de armazenamento e cookie de sessão** são prefixadas por
  `company.id`. Sem isso, duas plataformas na pré-visualização do construtor —
  onde todas vivem sob o mesmo domínio — compartilham tema, destinatários e
  sessão: o cliente A abre e vê os dados do cliente B.

Não edite o manifest à mão: ele é gerado, e edição manual volta atrás no próximo
`pull` do modelo.

## Variáveis de ambiente

Copie `.env.example` para `.env` (desenvolvimento) ou cadastre no provedor
(produção). As quatro são obrigatórias — sem qualquer uma delas o login não entra
e a emissão não sai.

São **duas** obrigatórias:

| Variável | O que é |
|---|---|
| `FISCAL_API_KEY` | Chave do cliente na API fiscal. **Vale dinheiro e emite nota em nome da empresa.** |
| `APP_ACCESS_PASSWORD` | Senha de acesso ao painel do cliente. |

As outras três o sistema resolve sozinho, e só existem para fugir do padrão:
`APP_USER` (vazio = o CNPJ do manifest), `SESSION_SECRET` (vazio = derivado da
chave da API por HMAC) e `FISCAL_API_URL` (vazio = o endereço padrão).

Cada variável a mais é uma chance a mais de errar um dígito copiando de um lugar
para outro — por isso são duas e não cinco.

**Nenhuma pode receber o prefixo `VITE_`.** O que leva esse prefixo vai para o
navegador, e a chave da API no navegador é a chave nas mãos de qualquer visitante.

## Ao mexer no modelo

- **Nunca reescreva histórico publicado** — nada de `force push`, `rebase` ou
  `amend` em commit já enviado. O branch conectado sincroniza com o construtor, e
  reescrever apaga o histórico do projeto do cliente lá.
- Mantenha o branch conectado sempre funcionando: cada commit aparece no editor.
- Nada de valor de cliente no código. Se um dado varia entre clientes, ele
  pertence ao manifest — e o gerador do Emissor precisa aprender a preenchê-lo.
- Ensinou algo novo à plataforma? **Ensine ao gerador junto**, senão o próximo
  cliente nasce sem.

## Stack

TanStack Start + React + TypeScript + Tailwind + shadcn/ui. Chamadas à API
fiscal passam por funções de servidor (`*.server.ts`) — é o que mantém a chave
fora do navegador.

```bash
npm install
npm run dev
```
