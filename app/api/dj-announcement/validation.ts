export interface DjAnnouncementRequest {
  profileId?: string
  scriptText?: string
  clear?: boolean
}

export interface ValidationError {
  error: string
}

export interface UpsertPayload {
  profile_id: string
  script_text: string
  is_active: boolean
  updated_at: string
}

export function validateRequest(
  body: DjAnnouncementRequest
): ValidationError | null {
  if (
    !body.profileId ||
    typeof body.profileId !== 'string' ||
    !body.profileId.trim()
  ) {
    return { error: 'Missing required field: profileId' }
  }
  if (
    !body.clear &&
    (!body.scriptText ||
      typeof body.scriptText !== 'string' ||
      !body.scriptText.trim())
  ) {
    return { error: 'Either scriptText or clear: true must be provided' }
  }
  return null
}

export function buildUpsertPayload(body: DjAnnouncementRequest): UpsertPayload {
  const profileId = body.profileId as string
  if (body.clear) {
    return {
      profile_id: profileId,
      script_text: '',
      is_active: false,
      updated_at: new Date().toISOString()
    }
  }
  return {
    profile_id: profileId,
    script_text: body.scriptText as string,
    is_active: true,
    updated_at: new Date().toISOString()
  }
}
