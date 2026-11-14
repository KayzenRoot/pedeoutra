import { BackendNotConfiguredError, supabase } from './supabase'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

export class EdgeFunctionError extends Error {
  readonly code: string
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'EdgeFunctionError'
    this.code = code
    this.status = status
    this.details = details
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: unknown
    message?: unknown
  }

  if (!response.ok) {
    const code = typeof payload.error === 'string' ? payload.error : 'request_failed'
    const message =
      typeof payload.message === 'string'
        ? payload.message
        : 'Não foi possível concluir a operação.'
    throw new EdgeFunctionError(code, message, response.status, payload as Record<string, unknown>)
  }

  return payload as T
}

/** Chamada pública (catálogo/recompra) usando anon key, sem sessão. */
export async function callPublicFunction<T>(
  name: string,
  body: unknown,
): Promise<T> {
  if (!SUPABASE_URL || !ANON_KEY) throw new BackendNotConfiguredError()

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(body),
  })

  return parseResponse<T>(response)
}

export async function getCatalogTemplates<T>(): Promise<T> {
  if (!SUPABASE_URL || !ANON_KEY) throw new BackendNotConfiguredError()

  const response = await fetch(`${SUPABASE_URL}/functions/v1/catalog-templates`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  })

  return parseResponse<T>(response)
}

export async function getOrderTracking<T>(token: string): Promise<T> {
  if (!SUPABASE_URL || !ANON_KEY) throw new BackendNotConfiguredError()

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/order-tracking-get?token=${encodeURIComponent(token)}`,
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
    },
  )

  return parseResponse<T>(response)
}

export async function getPrivateCatalog<T>(token: string): Promise<T> {
  if (!SUPABASE_URL || !ANON_KEY) throw new BackendNotConfiguredError()

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/private-catalog-get?token=${encodeURIComponent(token)}`,
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
    },
  )

  return parseResponse<T>(response)
}

export async function getPlanCatalog<T>(): Promise<T> {
  if (!SUPABASE_URL || !ANON_KEY) throw new BackendNotConfiguredError()

  const response = await fetch(`${SUPABASE_URL}/functions/v1/plan-catalog`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  })

  return parseResponse<T>(response)
}

export async function getPublicCatalog<T>(slug: string): Promise<T> {
  if (!SUPABASE_URL || !ANON_KEY) throw new BackendNotConfiguredError()

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/public-catalog?slug=${encodeURIComponent(slug)}`,
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
    },
  )

  return parseResponse<T>(response)
}

/** Chamada autenticada GET (console admin). */
export async function callAuthedGet<T>(
  name: string,
  query: Record<string, string | number | undefined> = {},
): Promise<T> {
  if (!supabase) throw new BackendNotConfiguredError()
  if (!SUPABASE_URL || !ANON_KEY) throw new BackendNotConfiguredError()

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession()
  if (sessionError || !sessionData.session) {
    throw new EdgeFunctionError('unauthorized', 'Sessão expirada. Entre novamente.', 401)
  }

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}${suffix}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
  })

  return parseResponse<T>(response)
}

/** Chamada autenticada multipart (upload de imagem). */
export async function callAuthedForm<T>(name: string, form: FormData): Promise<T> {
  if (!supabase) throw new BackendNotConfiguredError()
  if (!SUPABASE_URL || !ANON_KEY) throw new BackendNotConfiguredError()

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session) {
    throw new EdgeFunctionError('unauthorized', 'Sessão expirada. Entre novamente.', 401)
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: form,
  })

  return parseResponse<T>(response)
}

/** Chamada autenticada: inclui o JWT do fornecedor. */
export async function callAuthedFunction<T>(
  name: string,
  body: unknown = {},
): Promise<T> {
  if (!supabase) throw new BackendNotConfiguredError()

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession()
  if (sessionError || !sessionData.session) {
    throw new EdgeFunctionError('unauthorized', 'Sessão expirada. Entre novamente.', 401)
  }

  const { data, error } = await supabase.functions.invoke(name, {
    body: body as Record<string, unknown>,
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
  })

  if (error) {
    const context = (error as { context?: Response }).context
    if (context) {
      const payload = (await context.json().catch(() => ({}))) as {
        error?: unknown
        message?: unknown
      }
      const code = typeof payload.error === 'string' ? payload.error : 'request_failed'
      const message =
        typeof payload.message === 'string'
          ? payload.message
          : 'Não foi possível concluir a operação.'
      throw new EdgeFunctionError(code, message, context.status, payload as Record<string, unknown>)
    }
    throw new EdgeFunctionError('request_failed', error.message, 500)
  }

  return data as T
}
