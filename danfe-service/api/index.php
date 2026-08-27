<?php
/**
 * Endpoint HTTP do DANFE (Vercel PHP runtime).
 *
 * POST  body = XML (NFe ou nfeProc autorizado)  -> retorna application/pdf
 * POST  body = JSON {"xml": "...", "logo": "<base64>", "posicao": "L|C|R"}
 *       -> mesmo PDF, com a logomarca do emitente no quadro dele
 *
 * As duas formas convivem de proposito: quem manda XML cru continua funcionando
 * sem saber que a logo existe. O emissor so manda JSON quando ha logo, para que
 * uma versao antiga deste servico nunca receba um corpo que nao entende.
 * GET   -> health check (informa se a extensao gd esta disponivel)
 *
 * Opcional: se a env DANFE_KEY estiver definida, exige o header x-danfe-key igual.
 */

ini_set('display_errors', '0'); // nunca vazar erro no corpo (corromperia o PDF)
error_reporting(E_ALL);

require __DIR__ . '/../vendor/autoload.php';

use NFePHP\DA\NFe\Danfe;

function jsonOut(int $code, array $data): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Health check + diagnostico de extensoes
if ($method === 'GET') {
    jsonOut(200, [
        'ok'      => true,
        'service' => 'danfe-service',
        'php'     => PHP_VERSION,
        'gd'      => extension_loaded('gd'),
        'dom'     => extension_loaded('dom'),
        'mbstring'=> extension_loaded('mbstring'),
    ]);
}

if ($method !== 'POST') {
    jsonOut(405, ['ok' => false, 'error' => 'Use POST com o XML no corpo, ou GET para health check.']);
}

// Chave compartilhada opcional
$expected = getenv('DANFE_KEY');
if ($expected !== false && $expected !== '') {
    $got = $_SERVER['HTTP_X_DANFE_KEY'] ?? '';
    if (!hash_equals($expected, $got)) {
        jsonOut(401, ['ok' => false, 'error' => 'Nao autorizado (x-danfe-key)']);
    }
}

$corpo = file_get_contents('php://input');
if ($corpo === false || trim($corpo) === '') {
    jsonOut(400, ['ok' => false, 'error' => 'Corpo vazio no POST']);
}

$xml     = $corpo;
$logo64  = null;
$posicao = 'L';

// JSON so quando o cliente diz que e JSON. Adivinhar pelo primeiro caractere
// quebraria um XML que comece com espaco ou BOM.
$tipo = strtolower($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '');
if (strpos($tipo, 'application/json') !== false) {
    $dados = json_decode($corpo, true);
    if (!is_array($dados) || !isset($dados['xml'])) {
        jsonOut(400, ['ok' => false, 'error' => 'JSON precisa ter a chave "xml".']);
    }
    $xml = (string) $dados['xml'];
    if (!empty($dados['logo'])) {
        $logo64 = (string) $dados['logo'];
    }
    if (!empty($dados['posicao']) && in_array($dados['posicao'], ['L', 'C', 'R'], true)) {
        $posicao = $dados['posicao'];
    }
}

if (trim($xml) === '') {
    jsonOut(400, ['ok' => false, 'error' => 'XML vazio no corpo do POST']);
}

$arquivoDaLogo = null;
try {
    $danfe = new Danfe($xml);

    if ($logo64 !== null) {
        // A biblioteca quer um CAMINHO de arquivo, nao bytes. Em serverless o
        // unico lugar gravavel e o temporario do sistema, e ele e efemero — o
        // arquivo vale so para esta requisicao e e apagado no finally.
        $bytes = base64_decode(preg_replace('#^data:image/[a-z+]+;base64,#i', '', $logo64), true);
        if ($bytes !== false && strlen($bytes) > 0) {
            $arquivoDaLogo = tempnam(sys_get_temp_dir(), 'danfe-logo-');
            file_put_contents($arquivoDaLogo, $bytes);
            // 'L' esquerda, 'C' centro, 'R' direita; o terceiro parametro e
            // "somente a imagem", que esconderia a razao social do emitente.
            $danfe->logoParameters($arquivoDaLogo, $posicao, false);
        }
    }

    $pdf = $danfe->render();
} catch (\Throwable $e) {
    jsonOut(500, ['ok' => false, 'error' => 'Falha ao gerar DANFE: ' . $e->getMessage()]);
} finally {
    // Sem isto, cada nota emitida deixa um arquivo para tras no container.
    if ($arquivoDaLogo !== null && is_file($arquivoDaLogo)) {
        @unlink($arquivoDaLogo);
    }
}

header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="danfe.pdf"');
header('Content-Length: ' . strlen($pdf));
echo $pdf;
