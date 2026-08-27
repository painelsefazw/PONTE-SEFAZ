# Ponte SEFAZ

Ponte fiscal: o servico que fala com a SEFAZ e revende essa capacidade por API.

Isto e uma instalacao independente — banco proprio, certificado proprio,
clientes proprios. Nada e compartilhado com outra instancia, e essa separacao e
o ponto: **a mesma empresa nunca pode emitir por duas instalacoes ao mesmo
tempo.** A numeracao das notas vive no banco, com chave `(cnpj, serie,
ambiente)`; dois bancos sao dois contadores que nao se enxergam, e o resultado
e a SEFAZ recusando por duplicidade — ou pior, autorizando com buracos na
sequencia que o Fisco cobra na apuracao.

## O que ela faz

- **NF-e (modelo 55)** — emissao, cancelamento, carta de correcao, inutilizacao,
  consulta, DANFE em PDF, XML autorizado.
- **NFC-e (modelo 65)** — o cupom do balcao, com CSC e QR Code.
- **NFS-e** — emissao pelo Ambiente Nacional, cancelamento, DANFSE.
- **Documentos recebidos** — NF-e de fornecedores (Distribuicao DF-e) com
  manifestacao, e NFS-e recebidas do Ambiente Nacional.
- **Cadastros fiscais** — produtos com NCM/CST/origem, regras por NCM e UF,
  catalogo de servicos com NBS e retencoes federais.
- **Revenda por API** — clientes, chaves, escopos, limites por plano, webhooks,
  auditoria e log de requisicoes.
- **Plataformas white-label** — gera o repositorio pronto da plataforma de cada
  cliente a partir de `platform-template/`, com a marca dele.

## Instalacao

Leia [INSTALACAO.md](INSTALACAO.md). Sao quatro passos e nenhum exige migration
escrita a mao: o banco se cria sozinho.

## Front end

O painel administrativo ja vem pronto e funcionando, servido pela propria
aplicacao em `/`. Para construir outro por fora — em Lovable, por exemplo —
o contrato das rotas de clientes esta em
[docs/API-CLIENTES.md](docs/API-CLIENTES.md).

## Ao mexer

`npm test` antes de publicar. A suite cobre o que a SEFAZ rejeita, e cada
teste guarda o motivo pelo qual ele existe — geralmente uma nota recusada de
verdade.
