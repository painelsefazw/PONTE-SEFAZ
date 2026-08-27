# Ambiente Nacional da NFS-e — material coletado

Levantado em 29/07/2026 contra o ambiente real, usando o certificado A1 de uma
empresa já cadastrada.

## Ambientes

| | Base |
|---|---|
| SEFIN — produção restrita | `https://sefin.producaorestrita.nfse.gov.br/SefinNacional` |
| SEFIN — produção | `https://sefin.nfse.gov.br/SefinNacional` |
| ADN — produção restrita | `https://adn.producaorestrita.nfse.gov.br` |
| ADN — produção | `https://adn.nfse.gov.br` |

## Autenticação

mTLS com certificado A1 ICP-Brasil. **Sem certificado tudo responde 403**,
inclusive a documentação — era isso que impedia levantar o contrato.

Confirmado: o certificado da 3A Comércio abre a produção restrita. Os
certificados que já usamos na NF-e servem para a NFS-e sem nenhuma alteração.

## Especificações baixadas

| Arquivo | Origem |
|---|---|
| `openapi-sefin.json` | `/SefinNacional/swagger/docs/v1` |
| `openapi-adn-contribuintes.json` | `/contribuintes/swagger/v1/swagger.json` |
| `openapi-adn-parametrizacao.json` | `/parametrizacao/swagger/v1/swagger.json` |
| `openapi-adn-municipios.json` | `/municipios/swagger/v1/swagger.json` |

Os caminhos não estão documentados no portal. O do SEFIN veio do
`initTry({ openApi: ... })` da página de docs; os do ADN, do `index.js` que o
Redoc carrega.

## Endpoints de emissão (SEFIN)

| Método | Caminho | O que faz |
|---|---|---|
| `POST` | `/nfse` | Recebe o DPS e gera a NFS-e, síncrono |
| `GET` | `/nfse/{chaveAcesso}` | Consulta pela chave |
| `POST` | `/nfse/{chaveAcesso}/eventos` | Registra evento (cancelamento) |
| `GET` | `/nfse/{chave}/eventos/{tipo}/{seq}` | Consulta evento |
| `GET` | `/dps/{id}` | Chave de acesso a partir do Id do DPS |
| `HEAD` | `/dps/{id}` | Verifica se já existe NFS-e para aquele DPS |

`DANFSe` e `ParametrosMunicipais` migraram para o ADN.

### Contrato

Envio: `{ "dpsXmlGZipB64": "<DPS assinado, gzip, base64>" }`

Sucesso devolve `tipoAmbiente`, `versaoAplicativo`, `dataHoraProcessamento`,
`idDps`, `chaveAcesso` (50 posições), `nfseXmlGZipB64` e `alertas[]`.
Erro devolve `erros[]` com código, descrição e complemento.

### Idempotência

`HEAD /dps/{id}` diz se já existe NFS-e para aquele identificador. É o
mecanismo para tratar timeout sem emitir duas vezes — equivale ao que fazemos
consultando a chave na NF-e.

## Schemas XSD

Baixados de `nfse-nacional/nfse-php` (`references/schemas`), que os distribui
conforme publicados pelo Sistema Nacional. Versão 1.01.

| Arquivo | Papel |
|---|---|
| `DPS_v1.01.xsd` | Raiz da Declaração de Prestação de Serviços |
| `NFSe_v1.01.xsd` | A nota gerada |
| `pedRegEvento_v1.01.xsd` | Pedido de registro de evento |
| `evento_v1.01.xsd` | Evento gerado |
| `tiposComplexos_v1.01.xsd` | Estruturas — onde vive o `TCInfDPS` |
| `tiposSimples_v1.01.xsd` | Tipos e formatos de cada campo |
| `tiposEventos_v1.01.xsd` | Tipos dos eventos |

Namespace: `http://www.sped.fazenda.gov.br/nfse`

## Estrutura do DPS

`DPS` → `infDPS` + `Signature`. Atributo `versao` obrigatório na raiz.
A assinatura vai sobre `infDPS`, como na NF-e vai sobre `infNFe`.

Ordem exigida dentro de `infDPS`:

```
tpAmb  dhEmi  verAplic  serie  nDPS  dCompet  tpEmit
cMotivoEmisTI?  chNFSeRej?  cLocEmi
subst  prest  toma  interm  serv  valores  IBSCBS
```

**`IBSCBS` também aparece aqui.** É o mesmo grupo da Reforma Tributária que já
implementamos para a NF-e — mais uma peça que atravessa.

### Formato do código de serviço

`TSCodTribNac` — **6 dígitos**: 2 do item da LC 116, 2 do subitem, 2 do
desdobro nacional. Não confundir com `TSCodNBS`, que tem 9.

**O desdobro começa em 01.** Não existe desdobro `00` para nenhum subitem.
Assumir zero como valor neutro é o erro natural de quem lê "2 dígitos de
desdobro", e rende `E0310`, que não diz qual das três partes está errada. Isso
está travado em `RegrasServico.validarServico`.

### Grupo `obra`

Obrigatório nos subitens de execução de obra e **proibido** em todos os outros
— as duas pontas são rejeitadas (`E0370` e `E0372`).

Dentro do `serv`, vem entre `cServ` e `infoCompl`. Exige exatamente um entre
`cObra` (CNO/CEI), `cCIB` e `end`. O `end` aqui é o `TCEnderObraEvento`, que
começa pelo CEP e não tem município — diferente do endereço das pessoas.

Subitens que exigem obra, levantados varrendo o item 07 inteiro:

`07.02` `07.04` `07.05` `07.06` `07.07` `07.08` `07.17` `07.19`

A fronteira fica dentro do próprio item 07: `07.01` (projeto) e `07.03`
(elaboração de planos) **não** são obra.

## IBS/CBS na NFS-e é outro grupo, não o da NF-e

Confundir os dois é fácil porque o nome é o mesmo. Na NF-e o `IBSCBS` vai **por
item**, com base de cálculo e alíquotas. Na NFS-e vai **uma vez por nota**, como
último elemento do `infDPS`, e declara só a situação tributária — quem calcula é
o Sistema Nacional.

Estrutura mínima (`TCRTCInfoIBSCBS`):

```
finNFSe   (só admite '0' = NFS-e regular)
cIndOp    (6 dígitos, tabela do Anexo VII — sem enumeração no XSD)
indDest   ('0' = o destinatário é o próprio tomador)
valores → trib → gIBSCBS → CST + cClassTrib [+ cCredPres]
```

O par `CST` / `cClassTrib` é o mesmo da NF-e: `000` / `000001` é tributação
integral.

**Limite não resolvido:** a estrutura foi confirmada como aceita pelo schema —
todas as variantes testadas passam — mas a **validade dos códigos não pôde ser
verificada**, porque a recusa por credenciamento (`E0084`) acontece antes da
validação do IBS/CBS. Valores obviamente falsos como `cIndOp = 999999` passam
igual. Por isso `codigoIndicadorOperacao` não tem valor padrão no código: seria
um palpite disfarçado de default.

## A tributação do ISSQN esconde grupos obrigatórios

`tributacaoISSQN` tem quatro valores e **dois deles exigem um grupo adicional**
que o XSD marca como `minOccurs="0"` — ou seja, o schema não cobra, a regra de
negócio cobra:

| Valor | Exige | Recusa sem ele |
|---|---|---|
| `1` tributável | — | — |
| `2` imunidade | `tpImunidade` (0 a 5) | `E0592` |
| `3` exportação | grupo `comExt` inteiro | `E0330` |
| `4` não incidência | — | — |

Isso não se descobre lendo o XSD, porque os grupos são opcionais lá. Só aparece
enviando.

`comExt` tem 8 campos obrigatórios. Nenhum tem valor padrão no código de
propósito: cada tabela tem um `0`/`00` que significa "desconhecido, não informado
na nota de origem", e usar isso como default seria declarar desconhecimento em
nome do contribuinte.

Outros dois grupos do `tribMun`, opcionais de verdade:

- `exigSusp` — suspensão por decisão judicial ou processo administrativo. O
  `nProcesso` é `[0-9]{30}`, mas o número do CNJ tem 20 dígitos: precisa de
  zeros à esquerda.
- `BM` — benefício municipal. O `nBM` **não é escolhido pelo contribuinte**: é o
  identificador que o Sistema Nacional gerou quando o município cadastrou o
  benefício. Número inventado retorna `E0541`.

Ordem dentro de `tribMun`: `tribISSQN`, `[cPaisResult]`, `[tpImunidade]`,
`[exigSusp]`, `[BM]`, `tpRetISSQN`, `[pAliq]` — note que a retenção vem **depois**
dos grupos opcionais, não logo após a tributação.

## Grupos que o XSD publicado tem e o ambiente não

Além do `nPedRegEvento` já citado, **`explRod`** (pedágio) não existe no schema
em produção. A mensagem de erro lista os filhos aceitos de `serv` e são só
`comExt, obra, atvEvento, infoCompl`. Chegou a ser implementado aqui e foi
removido: deixar um campo que garante rejeição é pior do que não ter o campo.

De passagem: o `TSPlaca` do XSD é `[A-Z]{2,3}[0-9]{4}|[A-Z]{3,4}[0-9]{3}` — nenhuma
das alternativas acomoda **placa Mercosul** (`AAA0A00`, com letra na 5ª posição).
O padrão é anterior a ela.

## DANFSE oficial só existe em produção

`GET /danfse/{chaveAcesso}` no **ADN** (não no SEFIN, cujo `/DANFSe` responde 501
dizendo que mudou de endereço). Host: `adn.nfse.gov.br`.

Na produção restrita o módulo não está publicado — qualquer caminho de `/danfse`
devolve 404 sem corpo, enquanto em produção devolve 404 tipado
(`application/problem+json`) para nota inexistente. Foi assim que dava para
distinguir "rota não existe" de "nota não encontrada".

Consequência prática: em homologação só o DANFSE simplificado funciona. O
endpoint da API prefere o oficial e cai no local, e devolve o header
`X-Danfse-Origem` (`adn` ou `local`) para não precisar abrir o PDF para saber
qual respondeu.

## Substituição não é evento

Tentar registrar o `e105102` em `POST /nfse/{chave}/eventos` é recusado com
`E1861` — *"não é aceito pelo método POST da API Eventos"* (a mensagem da SEFIN
tem dois erros de digitação: "Cancelamentno" e "Substiuição").

O caminho é o grupo `subst` do `infDPS`: emite-se a nota **correta** declarando
qual ela substitui, e o Sistema Nacional cancela a antiga ao autorizar. É a
saída quando o prazo de cancelamento do município já venceu.

```
subst → chSubstda (50 dígitos) + cMotivo (2 dígitos) + [xMotivo]
```

Duas pegadinhas: os códigos de motivo da substituição têm **dois** dígitos
(`01`…`05`, `99`) enquanto os do cancelamento têm **um** (`1`, `2`, `9`); e o
`xMotivo` é opcional aqui e obrigatório no cancelamento.

De passagem: se algum dia o `e105102` for aceito como evento, o `xDesc` dele
precisa vir **com** cedilha e acento — `"Cancelamento de NFS-e por Substituição"`.
O XSD publicado traz a enumeração sem acento e o ambiente real recusa essa
forma. O cancelamento comum não tem acento em nenhuma das versões, então não dá
para inferir um pelo outro.

## Eventos: o que o contribuinte pode registrar

Dos 16 do XSD, a maioria não é dele. Dá para saber quais pela estrutura:

| Evento | Quem emite |
|---|---|
| `e101101` cancelamento | contribuinte ✅ implementado |
| `e101103` solicitação de análise fiscal | contribuinte ✅ implementado |
| `e105102` cancelamento por substituição | ninguém, via evento — ver acima |
| `e105104` / `e105105` deferido / indeferido | fisco, em resposta ao `e101103` |
| `e205204` confirmação tácita | o sistema, por decurso de prazo |
| `e205208` anulação da rejeição | fisco (exige `CPFAgTrib`) |
| `e305101` a `e305103` de ofício | município |
| **`e202201` `e203202` `e204203`** confirmação | contribuinte ❌ **bloqueado** |
| **`e202205` `e203206` `e204207`** rejeição | contribuinte ❌ **bloqueado** |

Os seis de manifestação estão bloqueados por um impedimento concreto: o `xDesc`
deles é enumeração fechada e o ambiente real recusa o texto do XSD publicado.
Foram testadas nove grafias contra a produção restrita — com e sem acento, com
"de" no lugar de "do", em caixa alta, com "de Serviço" no fim — e todas
falharam. A mensagem de erro **não enumera** o valor aceito, só diz
*"The Enumeration constraint failed"*, então não há como descobrir por
tentativa dirigida. Ficaram fora de propósito: entregá-los às cegas seria um
caminho que rejeita sempre.

O `e101103` funciona, e com o `xDesc` **acentuado** — ao contrário do XSD
publicado, mesma inversão do cancelamento por substituição.

## Consulta de eventos

`GET /nfse/{chave}/eventos/{tipo}/{seq}`. Sem ela o status guardado localmente
só reflete o que passou pelo nosso sistema: cancelamento de ofício pelo
município (`e305101`), bloqueio (`e305102`) e rejeição pelo tomador acontecem
por fora.

## A SEFIN ignora o rótulo de fuso

Ela compara a hora de parede como se fosse de Brasília. Comprovado enviando o
**mesmo instante** com dois rótulos:

| `dhEmi` enviado | Resposta |
|---|---|
| `2026-07-30T01:48:29+00:00` | `E0008` — emissão posterior ao processamento |
| `2026-07-29T22:48:29-03:00` | passa (para em `E0084`) |

Isso torna o fuso do servidor relevante: o mesmo código funciona numa máquina
em UTC-3 e quebra em produção no Vercel, que roda em UTC. Por isso
`gerarDhEmiDps` e `gerarCompetencia` convertem para `America/Sao_Paulo` em vez
de usar o relógio local — e os testes fixam o instante, para valerem em
qualquer fuso.

A competência tem o mesmo risco por outro caminho: num servidor em UTC, as 21h
do último dia do mês já são o dia 1º do mês seguinte, e o ISS iria para a
apuração do mês errado.

**Na NF-e isso não é problema:** a SEFAZ honra o rótulo. Notas reais de produção
saem com `dhEmi ...+00:00` e a SEFAZ devolve `dhRecbto` equivalente em `-03:00`.
São dois fiscos com validações diferentes — não unificar o tratamento sem testar.

## Armadilhas de polaridade e formato nos valores

**`tpRetISSQN` é invertido em relação à intuição:** `1` = **não** retido,
`2` = retido pelo tomador, `3` = retido pelo intermediário. Outros emissores
usam `1` para "sim, retido", e trocar os dois inverte quem paga o ISS na nota.
Não é erro de schema — a nota é autorizada com o tributo atribuído a quem não
deve, e aí só o cancelamento resolve. Travado em `tests/nfse/DpsValores.test.ts`.

Quando é `2` ou `3`, o endereço nacional do tomador passa a ser obrigatório, e
a SEFIN recusa com `E0237`. A mensagem fala de retenção, o que confunde quem
não pediu retenção nenhuma — foi assim que a inversão apareceu.

**Os decimais não aceitam "número com casas decimais".** O padrão de
`TSDec15V2` e companhia é `0|0\.[0-9]{2}|[1-9]{1}[0-9]{0,N}(\.[0-9]{2})?`, o
que recusa `100.5` (uma casa), `0100.00` (zero à esquerda) e `100.567` (três
casas). A recusa é `E1235`, que não diz o campo. `decimalDps` normaliza tudo
antes de emitir, arredondando a terceira casa em vez de truncar.

**O INSS retido chama `vRetCP`** — CP de contribuição previdenciária. Não há
campo com "INSS" no nome.

**PIS e COFINS andam num grupo único** (`piscofins`) com um CST comum de dois
dígitos (`00` a `09`), diferente da NF-e, onde cada um tem seu grupo e o CST
decide qual estrutura usar.

## Como o contrato foi levantado

A lista oficial de códigos não é publicada em formato consultável, e o endpoint
de alíquotas do ADN não serve de fonte (ver abaixo). O que funcionou foi usar as
rejeições da própria SEFIN como oráculo — ela valida nesta ordem, e cada erro
revela uma coisa diferente:

| Erro | O que significa |
|---|---|
| `E0310` | o código não existe na lista nacional |
| `E0370` | o grupo de obra é obrigatório e não veio |
| `E0372` | o grupo de obra veio e não é permitido |
| `E0312` | o código existe, mas o município não o administra |
| `E0084` | o município administra, mas o CNPJ não tem estabelecimento lá |

Como `E0370`/`E0372` são avaliados **antes** de `E0312`, dá para separar "é
serviço de obra" de "o município administra" sem nenhuma tabela.

Cuidado ao ler os resultados: `E0372` não prova que o município administra o
código — prova só que ele existe e não é obra. Confirmar sempre reenviando sem
o grupo de obra.

## O schema em produção não é o publicado

Vale para o pedido de registro de evento (cancelamento). Os dois pacotes XSD
distribuídos — o `v1.00` de setembro/2025 e o `v1.01` que as bibliotecas usam —
descrevem o `infPedReg` assim:

| | XSD publicado | SEFIN 1.6.0 (real) |
|---|---|---|
| Tipo do atributo `Id` | `TSIdPedRefEvt` | `TSIdPedRegEvt` |
| Formato do `Id` | `PRE` + 59 dígitos | `PRE` + **56** dígitos |
| Composição | chave(50) + tipo(6) + nPedRegEvento(3) | chave(50) + tipo(6) |
| Elemento `nPedRegEvento` | existe, entre `chNFSe` e o evento | **não existe** |

Com o formato publicado, a SEFIN recusa com `E1235` e *"The Pattern constraint
failed"*. Foi preciso varrer comprimentos até achar o que passa: qualquer `Id`
só-dígitos entre 50 e 62 posições é recusado, exceto 56.

O que denunciou o elemento a mais foi a própria mensagem de erro, que lista o
que ela aceita depois de `chNFSe` — e são só os grupos de evento
(`e101101`, `e105102`, …), sem `nPedRegEvento`.

Se o ambiente for alinhado ao XSD publicado, o teste que trava o formato do
`Id` em `tests/nfse/EventoNfse.test.ts` é que vai apontar onde mexer.

## Resposta de erro muda de nome conforme o serviço

A emissão devolve `erros[]`; o registro de evento devolve `erro[]`, no
singular. E quando não há detalhe, vem `"erro": []` com HTTP 500 — que foi a
resposta para pedido de evento sobre nota inexistente.

## Emitir e baixar são coisas separadas — e só uma depende de credenciamento

Esta é a distinção que muda o que dá para fazer hoje. `GET
/parametrizacao/{municipio}/convenio` no ADN devolve **dois** indicadores:

| Campo | O que significa |
|---|---|
| `aderenteEmissorNacional` | o município usa o Emissor Nacional para **gerar** notas |
| `aderenteAmbienteNacional` | o município **manda os dados** das notas para o ADN |

A maioria dos municípios tem emissor próprio e é aderente só ao Ambiente. Nos
quatro municípios das empresas cadastradas, medido em **produção**:

| Município | Emissor Nacional | Ambiente Nacional |
|---|---|---|
| Jaíba (MG) | 0 | 1 |
| Guarulhos (SP) | 0 | 1 |
| Mogi das Cruzes (SP) | 0 | 1 |
| São Paulo (SP) | 0 | 1 |

**Cuidado com a produção restrita:** lá São Paulo aparece com
`aderenteEmissorNacional = 1`. É configuração do ambiente de teste e não
corresponde à realidade — medir adesão em homologação leva à conclusão errada.

Consequência: **nenhuma das empresas emite** pelo Sistema Nacional, e isso não
se resolve por código. Mas **todas baixam**: `GET /contribuintes/DFe/{NSU}` no
ADN de produção devolve as NFS-e delas com o XML completo e autorizado — as
emitidas pelo sistema da prefeitura e as recebidas de fornecedores.

A leitura é incremental por NSU, traz até 50 documentos por lote, e o serviço
limita a frequência com HTTP 429 **em HTML**, não em JSON — tratar antes do
`JSON.parse`.

## O que bloqueia a emissão hoje

Duas condições estão fora do nosso código, e as duas precisam ser verdade:

**1. O município tem que ser aderente ao Emissor Nacional.**
`GET /parametrizacao/{municipio}/convenio` devolve `aderenteEmissorNacional`.
Das 23 empresas cadastradas, só São Paulo capital (3550308) tem `1`. Mogi das
Cruzes (3530607), onde está a maioria, tem `0` — e a SEFIN recusa com `E0039`.

**2. O CNPJ tem que constar como contribuinte naquele município.**
Testado com a empresa de São Paulo: a SEFIN recusa com `E0084` mesmo com o
cadastro correto (CNPJ ativo, endereço na Av. Paulista, confirmado na Receita).
A verificação é contra os cadastros CNPJ e CNC NFS-e da produção restrita.

Ou seja: o motor está pronto e o contrato está fechado, mas a autorização de uma
nota depende de credenciamento junto ao município. Não há alteração de código
que contorne isso.

## Pendência

O endpoint `GET /{municipio}/{servico}/{competencia}/aliquota` responde 400 com
*"o código do serviço deve ser composto por nove dígitos"* para **qualquer**
entrada — 6 dígitos, 9 dígitos, 11 dígitos, com e sem zeros à esquerda. A
mensagem não corresponde ao que foi enviado, então o endpoint não serve para
descobrir códigos válidos nem alíquotas.

Não é roteamento nem autenticação: `GET /{municipio}/convenio` e
`GET /{municipio}/{competencia}/retencoes` respondem normalmente com o mesmo
certificado.
