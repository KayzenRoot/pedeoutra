import { sha256Hex } from './tokens.ts'
import { MAX_BODY_BYTES } from './validation.ts'
import { clientIpFromHeaders } from './request-ip.ts'

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly publicMessage: string
  readonly details?: Record<string, unknown>

  constructor(
    status: number,
    code: string,
    publicMessage = code,
    details?: Record<string, unknown>,
  ) {
    super(code)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.publicMessage = publicMessage
    this.details = details
  }
}

function allowedOrigins(): string[] {
  return (Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function corsHeaders(req: Request): Record<string, string> {
  const allowed = allowedOrigins()
  const requestOrigin = req.headers.get('origin')
  const origin = requestOrigin && allowed.includes(requestOrigin) ? requestOrigin : allowed[0] ?? ''
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-reconcile-token',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

export function errorResponse(
  req: Request,
  status: number,
  code: string,
  message = code,
  details?: Record<string, unknown>,
): Response {
  return jsonResponse(req, { error: code, message, ...(details ?? {}) }, status)
}

export function preflightResponse(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) })
}

export function methodNotAllowed(req: Request, allowed: string[]): Response {
  return jsonResponse(
    req,
    { error: 'method_not_allowed', message: `Método permitido: ${allowed.join(', ')}` },
    405,
    { Allow: allowed.join(', ') },
  )
}

export function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? ''
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  return token || null
}

export async function readJson(req: Request): Promise<unknown> {
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new HttpError(413, 'payload_too_large')
  }
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large')
  if (!text.trim()) throw new HttpError(400, 'empty_body')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}

export function appBaseUrl(): string {
  const raw =
    Deno.env.get('APP_URL')?.trim() ||
    Deno.env.get('APP_ORIGIN')?.split(',')[0]?.trim() ||
    'http://localhost:5173'
  return raw.replace(/\/+$/, '')
}

export function clientIp(req: Request): string {
  return clientIpFromHeaders(req.headers)
}

export async function rateBucket(req: Request, scope: string): Promise<string> {
  return `${scope}:${await sha256Hex(clientIp(req))}`
}

export function logError(
  scope: string,
  error: unknown,
  extra: Record<string, string | number | boolean | null> = {},
): void {
  const message = error instanceof Error ? error.message : 'unknown_error'
  console.error(JSON.stringify({ scope, error: message, ...extra }))
}

export async function withHttpErrors(
  req: Request,
  scope: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  if (req.method === 'OPTIONS') return preflightResponse(req)
  try {
    return await handler()
  } catch (error) {
    if (error instanceof HttpError) {
      return errorResponse(req, error.status, error.code, error.publicMessage, error.details)
    }
    logError(scope, error)
    return errorResponse(req, 500, 'internal_error', 'Não foi possível concluir a operação.')
  }
}
