import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { logError } from './http.ts'

export async function auditEvent(
  supabase: SupabaseClient,
  input: {
    organizationId: string
    actorUserId: string | null
    action: string
    entity: string
    entityId: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  try {
    const { error } = await supabase.from('audit_events').insert({
      organization_id: input.organizationId,
      actor_user_id: input.actorUserId,
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId,
      metadata: input.metadata ?? {},
    })
    if (error) logError('audit_insert', error, { action: input.action })
  } catch (error) {
    logError('audit_insert', error, { action: input.action })
  }
}
