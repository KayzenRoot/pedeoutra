import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { HttpError } from './http.ts'
import { sha256Hex } from './tokens.ts'

export const API_KEY_PATTERN = /^po_(?:live|test)_[A-Za-z0-9_-]{43}$/

export interface ApiKeyContext {
  keyId: string
  organizationId: string
  scopes: string[]
  prefix: string
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCodePoint(byte)
  let encoded = btoa(binary).replaceAll('+', '-').replaceAll('/', '_')
  while (encoded.endsWith('=')) encoded = encoded.slice(0, -1)
  return encoded
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `po_live_${base64UrlEncode(bytes)}`
}

export function apiKeyPrefix(value: string): string {
  return value.slice(0, 12)
}

export function hasApiScope(context: ApiKeyContext, scope: string): boolean {
  return context.scopes.includes(scope)
}

export async function requireApiKey(
  req: Request,
  supabase: SupabaseClient,
): Promise<ApiKeyContext> {
  const authorization = req.headers.get('authorization') ?? ''
  const headerKey = req.headers.get('x-api-key') ?? ''
  const raw = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : headerKey.trim()
  if (!API_KEY_PATTERN.test(raw)) {
    throw new HttpError(401, 'invalid_api_key', 'Chave de API inválida.')
  }

  const hash = await sha256Hex(raw)
  const { data: key, error } = await supabase
    .from('api_keys')
    .select('id, organization_id, scopes, status, expires_at, key_prefix')
    .eq('key_hash', hash)
    .maybeSingle()
  if (error) throw new HttpError(503, 'api_key_lookup_failed')
  if (key?.status !== 'active') {
    throw new HttpError(401, 'invalid_api_key', 'Chave de API inválida.')
  }
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
    throw new HttpError(401, 'expired_api_key', 'Chave de API expirada.')
  }

  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)
    .then(() => undefined)

  return {
    keyId: key.id,
    organizationId: key.organization_id,
    scopes: key.scopes ?? [],
    prefix: key.key_prefix,
  }
}
