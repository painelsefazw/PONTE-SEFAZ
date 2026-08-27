# Obtenção de Pacotes XSD Oficiais (NF-e)

Para fins de validação técnica exata da SEFAZ, o projeto requer os esquemas XML (XSD) originais. 
Este repositório NÃO inclui artefatos pré-fabricados, URLs de origem duvidosa ou hashes inventados.

## 1. Instruções para Download Legítimo
O responsável pela liberação deve obter o pacote fisicamente de forma verificável:
1. Acesse o **Portal Nacional da NF-e** oficial da Receita (Ex: nfe.fazenda.gov.br).
2. Confirme o certificado SSL do portal antes de realizar o download.
3. Obtenha o pacote atual. Registre a data de obtenção, o link físico original de onde obteve e a versão exata do pacote (ex: `PL_009i`).
4. Extraia o pacote e garanta que o XSD principal (`enviNFe_v4.00.xsd`) possui todos os seus `includes` e `imports` sanados dentro da própria pasta, desfazendo hierarquias complexas que quebrem os caminhos relativos, caso necessário.
5. Impeça arquivos vazios, placeholders ou nomes genéricos sem a versão.

## 2. Inserção e Manifesto Estruturado (Obrigatório)
Copie apenas os `.xsd` para a pasta `/schemas/`.
O Pipeline requer um arquivo `manifest_sha256.json` validável. Não crie um manifesto em texto puro ou `Get-FileHash > .txt`. Utilize exclusivamente a ferramenta da esteira para montar a hierarquia JSON.

Execute em um PowerShell configurado no diretório base do projeto:
```powershell
.\scripts\generate_schema_manifest.ps1 -SchemasPath ".\schemas"
```

O script criará o JSON contendo os nomes, caminhos relativos, tamanhos (size em bytes), SHA-256 (hash) e a data de geração de todos os itens em `/schemas/`.

O script `validate_schemas.js` da esteira validará estruturalmente este manifesto, travando intencionalmente se houver omissões ou quebra criptográfica. A validação XSD e as Etapas subsequentes do CI permanecem bloqueadas intencionalmente enquanto este procedimento não for satisfeito.
