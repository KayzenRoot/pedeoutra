import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { HttpError } from './http.ts'

export async function consumeRateLimit(
  supabase: SupabaseClient,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('api_consume_rate_limit', {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) throw new HttpError(503, 'rate_limit_unavailable')
  return data === true
}

export async function enforceRateLimit(
  supabase: SupabaseClient,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const allowed = await consumeRateLimit(supabase, bucket, limit, windowSeconds)
  if (!allowed) {
    throw new HttpError(429, 'rate_limited', 'Muitas tentativas. Aguarde alguns minutos.')
  }
}
