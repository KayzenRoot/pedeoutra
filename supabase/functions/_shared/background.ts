import { logError } from './http.ts'

/**
 * Supabase Edge Functions expõem EdgeRuntime.waitUntil; em Deno local ou em
 * testes, aguardamos a promessa para não perder o processamento.
 */
export async function runInBackground(scope: string, task: Promise<unknown>): Promise<void> {
  const guarded = task.catch((error) => logError(scope, error))
  const runtime = (
    globalThis as {
      EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void }
    }
  ).EdgeRuntime

  if (runtime && typeof runtime.waitUntil === 'function') {
    runtime.waitUntil(guarded)
    return
  }
  await guarded
}
