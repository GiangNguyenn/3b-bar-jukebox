import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createModuleLogger } from '@/shared/utils/logger'
import {
  validateRequest,
  buildUpsertPayload,
  type DjAnnouncementRequest
} from './validation'

const logger = createModuleLogger('dj-announcement')

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: DjAnnouncementRequest
  try {
    body = (await request.json()) as DjAnnouncementRequest
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  console.warn('[dj-announcement] received:', JSON.stringify(body))

  const validationError = validateRequest(body)
  if (validationError) {
    console.warn('[dj-announcement] validation error:', validationError.error)
    return NextResponse.json(validationError, { status: 400 })
  }

  const payload = buildUpsertPayload(body)
  console.warn('[dj-announcement] upserting payload:', JSON.stringify(payload))

  try {
    const { error, data } = await supabaseAdmin
      .from('dj_announcements')
      .upsert(payload, { onConflict: 'profile_id' })
      .select()

    if (error) {
      console.warn('[dj-announcement] upsert error:', error.message, error.code, error.details)
      logger('ERROR', `Failed to upsert announcement: ${error.message}`)
      return NextResponse.json(
        { success: false, error: 'Database write failed' },
        { status: 500 }
      )
    }

    console.warn('[dj-announcement] upsert success, rows:', JSON.stringify(data))
    return NextResponse.json({ success: true })
  } catch (err) {
    logger(
      'ERROR',
      'Unexpected error in dj-announcement',
      undefined,
      err as Error
    )
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
