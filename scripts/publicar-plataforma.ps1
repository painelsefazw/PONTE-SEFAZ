<#
.SYNOPSIS
  Publica a plataforma de um cliente no repositorio dele, no GitHub.

.DESCRIPTION
  Faz na sua maquina o que a rota `/publicar-repositorio` faria no servidor — e
  sem token nenhum.

  A diferenca e onde a credencial mora: o servidor na Vercel nao tem nenhuma, e
  por isso precisaria de um GITHUB_TOKEN guardado la (que passa a poder escrever
  em tudo que alcanca, e vence sem avisar). Aqui quem autentica e o Git desta
  maquina, com a credencial que voce ja usa todo dia. Nada novo e criado, nada
  novo e guardado.

  O que ele faz, na ordem:
    1. Baixa do Emissor o repositorio pronto do cliente (modelo + manifest).
    2. Mostra de quem e a plataforma e PEDE CONFIRMACAO.
    3. Clona o repositorio de destino.
    4. Aplica os arquivos por cima, preservando o `.lovable/project.json`.
    5. Comita e empurra — sem reescrever historico.
    6. Grava a URL do repositorio no cadastro do cliente.

.PARAMETER Cnpj
  CNPJ do cliente, com ou sem pontuacao.

.PARAMETER Repositorio
  URL do repositorio que o construtor criou. Ex.: https://github.com/dono/repo

.PARAMETER Senha
  Senha de admin do Emissor. Sem ela, e lida do `.env` do projeto.

.PARAMETER SemConfirmar
  Pula a confirmacao. Use so em automacao, nunca no uso normal: a confirmacao e
  o que impede publicar a plataforma de um cliente no repositorio de outro.

.EXAMPLE
  .\publicar-plataforma.ps1
  Pergunta o CNPJ e o repositorio.

.EXAMPLE
  .\publicar-plataforma.ps1 -Cnpj 62050825000178 -Repositorio https://github.com/dono/repo
#>

[CmdletBinding()]
param(
  [string]$Cnpj,
  [string]$Repositorio,
  [string]$Senha,
  [string]$Api = 'https://nfe-emissor.vercel.app',
  [switch]$SemConfirmar
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # a barra de progresso suja a saida

function Passo($n, $texto) { Write-Host "`n[$n] $texto" -ForegroundColor Cyan }
function Ok($texto)        { Write-Host "    $texto" -ForegroundColor Green }
function Aviso($texto)     { Write-Host "    $texto" -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
# Entrada
# ---------------------------------------------------------------------------

if (-not $Cnpj) { $Cnpj = Read-Host 'CNPJ do cliente' }
$Cnpj = ($Cnpj -replace '\D', '')
if ($Cnpj.Length -ne 14) { throw "CNPJ deve ter 14 digitos (recebi $($Cnpj.Length))." }

if (-not $Repositorio) { $Repositorio = Read-Host 'URL do repositorio no GitHub' }
$Repositorio = $Repositorio.Trim()
if ($Repositorio -notmatch 'github\.com[/:][^/]+/[^/\s]+') {
  throw "URL nao reconhecida: '$Repositorio'. Use https://github.com/dono/repositorio"
}

# A senha do painel sai do .env do proprio projeto: ela ja esta nesta maquina, e
# pedir de novo a cada execucao levaria alguem a colar num arquivo qualquer.
if (-not $Senha) {
  $envPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
  if (Test-Path $envPath) {
    $linha = Select-String -Path $envPath -Pattern '^WEBAPP_SENHA=' | Select-Object -First 1
    if ($linha) { $Senha = ($linha.Line -replace '^WEBAPP_SENHA=', '').Trim() }
  }
}
if (-not $Senha) { $Senha = Read-Host 'Senha de admin do Emissor' }

$trabalho = Join-Path $env:TEMP "plataforma-$Cnpj-$(Get-Date -Format yyyyMMddHHmmss)"
New-Item -ItemType Directory -Force -Path $trabalho | Out-Null

try {
  # -------------------------------------------------------------------------
  Passo 1 'Baixando o repositorio pronto do Emissor'

  $zip = Join-Path $trabalho 'kit.zip'
  try {
    Invoke-WebRequest -Uri "$Api/api/admin/clients/$Cnpj/kit.zip" `
      -Headers @{ 'x-api-key' = $Senha } -OutFile $zip -TimeoutSec 120
  } catch {
    # O corpo do erro traz a mensagem que diz o que falta — "nenhum servico
    # contratado", "cliente nao encontrado". O status HTTP sozinho nao diz nada a
    # quem opera.
    #
    # A leitura tem tres tentativas porque o PowerShell entrega o corpo em
    # lugares diferentes conforme a versao e o uso de -OutFile: primeiro em
    # `ErrorDetails.Message`, depois no stream da resposta (que com -OutFile pode
    # ja ter sido consumido), e o status como ultimo recurso. A primeira versao
    # deste script lia so o stream e imprimia mensagem VAZIA — dizia que o
    # Emissor recusou, sem dizer por que.
    $detalhe = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $detalhe = $_.ErrorDetails.Message
    } elseif ($_.Exception.Response) {
      try {
        $fluxo = $_.Exception.Response.GetResponseStream()
        $fluxo.Position = 0
        $detalhe = (New-Object IO.StreamReader($fluxo)).ReadToEnd()
      } catch { }
    }

    # A mensagem do Emissor vem em JSON: mostrar o campo `erro` e mais legivel
    # que despejar o objeto inteiro na tela.
    try { $detalhe = ($detalhe | ConvertFrom-Json).erro } catch { }

    $status = ''
    if ($_.Exception.Response) {
      $codigo = [int]$_.Exception.Response.StatusCode
      $status = " (HTTP $codigo)"
    }
    if (-not $detalhe) { $detalhe = 'sem detalhe na resposta' }

    throw "O Emissor recusou o pedido do kit${status}: $detalhe"
  }

  $kit = Join-Path $trabalho 'kit'
  Expand-Archive -Path $zip -DestinationPath $kit -Force
  $qtd = (Get-ChildItem -Recurse -File $kit).Count
  Ok "$qtd arquivos"

  # -------------------------------------------------------------------------
  Passo 2 'Conferindo de quem e a plataforma'

  $manifestPath = Join-Path $kit 'src/platform.manifest.json'
  if (-not (Test-Path $manifestPath)) {
    throw 'O kit veio sem src/platform.manifest.json. Nao publico sem saber de quem e.'
  }
  $m = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

  $modulos = @()
  foreach ($nome in 'nfe', 'nfce', 'nfse') {
    if ($m.modules.$nome) { $modulos += $nome.ToUpper() }
  }

  Write-Host ''
  Write-Host '    ----------------------------------------------' -ForegroundColor DarkGray
  Write-Host "    | Empresa     : $($m.company.brandName)"
  Write-Host "    | Razao social: $($m.company.name)"
  Write-Host "    | CNPJ        : $($m.company.cnpj)  UF: $($m.company.uf)"
  Write-Host "    | Documentos  : $($modulos -join ', ')"
  Write-Host "    | Destino     : $Repositorio"
  Write-Host '    ----------------------------------------------' -ForegroundColor DarkGray

  # O CNPJ do manifest tem de ser o que se pediu. Se divergir, o Emissor devolveu
  # o cliente errado — e publicar seguiria em silencio.
  if (($m.company.cnpj -replace '\D', '') -ne $Cnpj) {
    throw "O manifest veio com o CNPJ $($m.company.cnpj), mas eu pedi $Cnpj. Nao publico."
  }
  if ($modulos.Count -eq 0) {
    throw 'Nenhum documento contratado. A plataforma abriria sem aba nenhuma de emissao.'
  }

  if (-not $SemConfirmar) {
    # Esta pergunta e a unica coisa entre um CNPJ digitado errado e a plataforma
    # de um cliente sobrescrevendo a de outro.
    $r = Read-Host "`n    Publicar esta plataforma no repositorio acima? (s/N)"
    if ($r -notmatch '^[sS]') { Write-Host "`nCancelado." -ForegroundColor Yellow; return }
  }

  # -------------------------------------------------------------------------
  Passo 3 'Clonando o repositorio de destino'

  $destino = Join-Path $trabalho 'destino'
  & git clone --quiet $Repositorio $destino
  if ($LASTEXITCODE -ne 0) { throw "git clone falhou. Confira a URL e o seu acesso ao repositorio." }

  $branch = (& git -C $destino rev-parse --abbrev-ref HEAD).Trim()
  Ok "branch $branch"

  # Sem isto o git imprime um aviso de fim de linha POR ARQUIVO — mais de cem
  # linhas que enterram o resultado. Vale so para este clone temporario.
  & git -C $destino config core.safecrlf false

  # -------------------------------------------------------------------------
  Passo 4 'Aplicando o modelo'

  # `.lovable/project.json` identifica ESTE projeto no construtor. Sobrescrever
  # com o de outro troca a identidade dele e o editor passa a apontar para outro
  # lugar. O kit ja vem sem esse arquivo; a guarda aqui e para o dia em que
  # alguem mudar isso do outro lado.
  $lovable = Join-Path $destino '.lovable/project.json'
  $guardado = $null
  if (Test-Path $lovable) { $guardado = Get-Content $lovable -Raw -Encoding UTF8 }

  Copy-Item -Path (Join-Path $kit '*') -Destination $destino -Recurse -Force

  if ($guardado) {
    New-Item -ItemType Directory -Force -Path (Split-Path $lovable) | Out-Null
    Set-Content -Path $lovable -Value $guardado -Encoding UTF8 -NoNewline
    Ok '.lovable/project.json preservado'
  }

  # -------------------------------------------------------------------------
  Passo 5 'Comitando e publicando'

  & git -C $destino add -A
  $mudou = (& git -C $destino status --porcelain) -ne $null
  if (-not $mudou) {
    Aviso 'Nada mudou: o repositorio ja esta igual ao modelo. Nada a publicar.'
  } else {
    $mensagem = @"
Plataforma fiscal da $($m.company.brandName)

Modelo unico das plataformas white-label e o manifest desta cliente.
Documentos: $($modulos -join ', '). CNPJ $($m.company.cnpj).

Publicado pelo script publicar-plataforma.ps1.
"@
    # A mensagem vai por ARQUIVO, nao pelo pipe: mandar pelo pipe no PowerShell
    # 5.1 grava um BOM, e ele entra na primeira linha da mensagem — invisivel no
    # editor e visivel para sempre no `git log`. Aconteceu no primeiro commit
    # publicado por este script.
    $arqMsg = Join-Path $trabalho 'mensagem.txt'
    [IO.File]::WriteAllText($arqMsg, $mensagem, (New-Object Text.UTF8Encoding $false))
    & git -C $destino commit --quiet -F $arqMsg
    if ($LASTEXITCODE -ne 0) { throw 'git commit falhou.' }

    # Sem --force em lugar nenhum: o construtor avisa que reescrever historico
    # publicado apaga o historico do projeto do lado dele.
    & git -C $destino push --quiet origin $branch
    if ($LASTEXITCODE -ne 0) { throw "git push falhou. Voce tem permissao de escrita nesse repositorio?" }

    $commit = (& git -C $destino rev-parse --short HEAD).Trim()
    Ok "commit $commit publicado em $branch"
  }

  # -------------------------------------------------------------------------
  Passo 6 'Registrando o repositorio no cadastro do cliente'

  try {
    $corpo = @{ repositoryUrl = $Repositorio } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Patch -Uri "$Api/api/admin/clients/$Cnpj" `
      -Headers @{ 'x-api-key' = $Senha } -ContentType 'application/json' `
      -Body $corpo -TimeoutSec 60 | Out-Null
    Ok 'cadastro atualizado'
  } catch {
    # Isto e organizacao, nao publicacao: a plataforma ja subiu. Falhar aqui nao
    # pode parecer que a publicacao falhou.
    Aviso "A plataforma foi publicada, mas nao consegui gravar a URL no cadastro: $($_.Exception.Message)"
  }

  # -------------------------------------------------------------------------
  Write-Host "`n  Pronto." -ForegroundColor Green
  Write-Host '  Falta no construtor: cadastrar os dois secrets e publicar.' -ForegroundColor Gray
  Write-Host '    FISCAL_API_KEY       (chave de API deste cliente)' -ForegroundColor Gray
  Write-Host '    APP_ACCESS_PASSWORD  (senha do painel dele)' -ForegroundColor Gray
  Write-Host '  As outras tres o modelo resolve sozinho.' -ForegroundColor Gray
}
finally {
  # A pasta de trabalho leva o kit e o clone. Some sempre, inclusive em erro:
  # kit de cliente esquecido no TEMP e dado de cliente parado onde ninguem olha.
  Remove-Item -Recurse -Force $trabalho -ErrorAction SilentlyContinue
}
