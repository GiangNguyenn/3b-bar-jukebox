export interface UserTokenHookResult {
  token: string | null
  loading: boolean
  error: string | null
  isRecovering: boolean
  isJukeboxOffline: boolean
  fetchToken?: () => Promise<string | null>
}

export function useUserToken(): UserTokenHookResult {
  return {
    token: null,
    loading: false,
    error: null,
    isRecovering: false,
    isJukeboxOffline: false,
    fetchToken: async (): Promise<string | null> => null
  }
}
