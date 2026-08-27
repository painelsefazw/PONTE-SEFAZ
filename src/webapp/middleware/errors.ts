import * as crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export const ERROR_CODES = {
  INVALID_API_KEY: { status: 401, message: 'API Key inválida ou revogada.' },
  API_KEY_REVOKED: { status: 401, message: 'API Key foi revogada.' },
  UNAUTHORIZED: { status: 401, message: 'Não autorizado. Informe credenciais válidas.' },
  FORBIDDEN: { status: 403, message: 'Acesso negado.' },
  ADMIN_REQUIRED: { status: 403, message: 'Apenas o administrador pode realizar esta operação.' },
  READONLY_KEY: { status: 403, message: 'Esta API Key é somente leitura.' },
  CLIENT_SUSPENDED: { status: 403, message: 'Cliente suspenso. Entre em contato com o suporte.' },
  CLIENT_CANCELLED: { status: 403, message: 'Contrato cancelado.' },
  BILLING_REQUIRED: { status: 402, message: 'Limite de uso atingido. Faça upgrade do plano.' },
  BILLING_PAST_DUE: { status: 402, message: 'Pagamento pendente. Regularize para continuar.' },
  SERVICE_NOT_ENABLED: { status: 403, message: 'Serviço não habilitado para esta empresa.' },
  SCOPE_NOT_ALLOWED: { status: 403, message: 'Permissão insuficiente para esta operação.' },
  RATE_LIMIT_EXCEEDED: { status: 429, message: 'Limite de requisições excedido. Tente novamente em breve.' },
  INVALID_CERTIFICATE: { status: 400, message: 'Certificado digital inválido.' },
  CERTIFICATE_EXPIRED: { status: 400, message: 'Certificado digital expirado.' },
  VALIDATION_ERROR: { status: 400, message: 'Dados inválidos.' },
  NOT_FOUND: { status: 404, message: 'Recurso não encontrado.' },
  PROVIDER_ERROR: { status: 502, message: 'Erro no provedor fiscal (SEFAZ/SEFIN).' },
  INTERNAL_ERROR: { status: 500, message: 'Erro interno do servidor.' },
  AMBIENTE_BLOCKED: { status: 403, message: 'API Key não autorizada para este ambiente.' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, details?: Record<string, unknown>, customMessage?: string) {
    const def = ERROR_CODES[code];
    super(customMessage || def.message);
    this.code = code;
    this.statusCode = def.status;
    this.details = details;
  }
}

export function generateRequestId(): string {
  return 'req_' + crypto.randomBytes(12).toString('base64url');
}

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const existing = req.header('x-request-id');
  (req as any).requestId = existing || generateRequestId();
  next();
}

export function errorResponse(
  res: Response,
  code: ErrorCode,
  details?: Record<string, unknown>,
  customMessage?: string,
): void {
  const def = ERROR_CODES[code];
  const requestId = (res.req as any)?.requestId || generateRequestId();
  const message = customMessage || def.message;
  res.status(def.status).json({
    success: false,
    // `erro` acompanha o envelope estruturado porque é o campo que o contrato da
    // API promete em QUALQUER resposta de erro, e é o que todo integrador lê.
    // Sem ele, justamente os erros que precisam de ação — plano estourado (402),
    // serviço não contratado (403), excesso de requisições (429) — chegavam na
    // tela do cliente como texto genérico de HTTP, sem dizer o que fazer.
    erro: message,
    error: {
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
    },
  });
}

export function errorHandlerMiddleware(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as any).requestId || generateRequestId();
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      erro: err.message,
      error: {
        code: err.code,
        message: err.message,
        requestId,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor.',
      requestId,
    },
  });
}
