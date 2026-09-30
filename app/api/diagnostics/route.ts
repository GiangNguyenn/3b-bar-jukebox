import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Database, Json } from '@/types/supabase'

/**
 * Receives browser logs, diagnostic snapshots and heartbeats from a signed-in
 * venue owner's browser (shared/utils/remoteLogShipper.ts) and stores them
 * for remote diagnosis. See docs/remote-diagnostics.md.
 */

const MAX_BODY_LENGTH = 400_000

const logSchema = z.object({
  ts: z.string().datetime(),
  level: z.enum(['INFO', 'WARN', 'ERROR']),
  message: z.string().max(2100),
  context: z.string().max(200).optional(),
  repeatCount: z.number().int().min(1).max(1_000_000).default(1),
  error: z
    .object({
      name: z.string().max(200).optional(),
      message: z.string().max(1100),
      stack: z.string().max(2100).optional()
    })
    .optional(),
  details: z.record(z.unknown()).optional(),
  path: z.string().max(500).optional(),
  sid: z.string().uuid().optional()
})

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  appVersion: z.string().max(100).optional(),
  page: z.string().max(500).optional(),
  logs: z.array(logSchema).max(50).optional(),
  snapshot: z
    .object({
      trigger: z.string().max(60),
      detail: z.string().max(600).optional(),
      severity: z.enum(['info', 'warning', 'error']),
      page: z.string().max(500).optional(),
      capturedAt: z.string().datetime(),
      data: z.unknown()
    })
    .optional(),
  heartbeat: z
    .object({
      userAgent: z.string().max(500).optional(),
      state: z.record(z.unknown())
    })
    .optional()
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  const raw = await request.text()
  if (raw.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 }
    )
  }
  const body = parsed.data

  const cookieStore = await cookies()
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Cookies can't always be written from a route handler
          }
        }
      }
    }
  )

  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // The profile always comes from the session, never from the payload
  const profileId = user.id
  const appVersion = body.appVersion ?? null

  const { error: sessionError } = await supabaseAdmin
    .from('client_sessions')
    .upsert(
      {
        session_id: body.sessionId,
        profile_id: profileId,
        last_seen_at: new Date().toISOString(),
        page: body.page ?? null,
        app_version: appVersion,
        ...(body.heartbeat && {
          user_agent: body.heartbeat.userAgent ?? null,
          state: body.heartbeat.state as Json
        })
      },
      { onConflict: 'session_id' }
    )
  if (sessionError) {
    return failure('client_sessions', sessionError.message)
  }

  if (body.logs && body.logs.length > 0) {
    const { error } = await supabaseAdmin.from('client_logs').insert(
      body.logs.map((log) => ({
        profile_id: profileId,
        session_id: log.sid ?? body.sessionId,
        logged_at: log.ts,
        level: log.level,
        context: log.context ?? null,
        message: log.message,
        repeat_count: log.repeatCount,
        error: (log.error as Json | undefined) ?? null,
        details: (log.details as Json | undefined) ?? null,
        path: log.path ?? null,
        app_version: appVersion
      }))
    )
    if (error) {
      return failure('client_logs', error.message)
    }
  }

  if (body.snapshot) {
    const { error } = await supabaseAdmin.from('diagnostic_snapshots').insert({
      profile_id: profileId,
      session_id: body.sessionId,
      captured_at: body.snapshot.capturedAt,
      trigger: body.snapshot.trigger,
      trigger_detail: body.snapshot.detail ?? null,
      severity: body.snapshot.severity,
      page: body.snapshot.page ?? null,
      app_version: appVersion,
      snapshot: (body.snapshot.data as Json | undefined) ?? {}
    })
    if (error) {
      return failure('diagnostic_snapshots', error.message)
    }
  }

  return new NextResponse(null, { status: 204 })
}

function failure(table: string, message: string): NextResponse {
  console.error(`[Diagnostics] Failed to write ${table}: ${message}`)
  return NextResponse.json(
    { error: `Failed to write ${table}` },
    { status: 500 }
  )
}
