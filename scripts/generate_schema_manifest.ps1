param (
    [string]$SchemasPath = ".\schemas"
)

$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path $SchemasPath "manifest_sha256.json"

$xsds = Get-ChildItem -Path $SchemasPath -Filter "*.xsd" -Recurse | Sort-Object FullName

if ($xsds.Count -eq 0) {
    Write-Error "Nenhum arquivo XSD encontrado em $SchemasPath"
    exit 1
}

$manifestObj = @{
    manifestVersion = "1.0"
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    logicalRoot = "schemas"
    totalFiles = $xsds.Count
    files = @{}
}

$schemasRootRaw = (Resolve-Path $SchemasPath).Path

foreach ($xsd in $xsds) {
    if ($xsd.Length -eq 0) {
        Write-Error "O arquivo $($xsd.FullName) está vazio e não pode ser parte do manifesto."
        exit 1
    }
    
    # Symlink Check (PowerShell 5.1/7+)
    if ($xsd.LinkType) {
         Write-Error "Symlinks são proibidos: $($xsd.FullName)"
         exit 1
    }

    $hash = (Get-FileHash -Path $xsd.FullName -Algorithm SHA256).Hash.ToLower()
    
    # Resolve relative path deterministicamente
    $relPath = $xsd.FullName.Substring($schemasRootRaw.Length).TrimStart('\')
    $relPath = $relPath -replace '\\', '/'

    $manifestObj.files[$relPath] = @{
        name = $xsd.Name
        relativePath = $relPath
        sizeBytes = $xsd.Length
        "SHA-256" = $hash
    }
}

$json = $manifestObj | ConvertTo-Json -Depth 5 -Compress
# Uncompress to stable formatting
$json = $manifestObj | ConvertTo-Json -Depth 5
Set-Content -Path $manifestPath -Value $json -Encoding UTF8

Write-Host "Manifesto estruturado gerado com sucesso em $manifestPath"
