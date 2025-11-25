import { useReducer, useEffect } from 'react'
import type {
  TokenResponse,
  TokenErrorResponse,
  OfflineErrorCode
} from '@/shared/types/token'
import { OFFLINE_ERROR_CODES } from '@/shared/constants/token'
import {
  safeParseTokenResponse,
  safeParseTokenErrorResponse
} from '@/shared/validations/tokenSchemas'

export interface UserTokenHookResult {
  token: string | null
  loading: boolean
  error: string | null
  isJukeboxOffline: boolean
}

interface UserTokenState {
  token: string | null
  loading: boolean
  error: string | null
  isJukeboxOffline: boolean
}

type UserTokenAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; token: string }
  | {
      type: 'FETCH_ERROR'
      error: string
      isJukeboxOffline: boolean
    }

function userTokenReducer(
  state: UserTokenState,
  action: UserTokenAction
): UserTokenState {
  switch (action.type) {
    case 'FETCH_START':
      return {
        ...state,
        loading: true,
        error: null,
        isJukeboxOffline: false
      }
    case 'FETCH_SUCCESS':
      return {
        token: action.token,
        loading: false,
        error: null,
        isJukeboxOffline: false
      }
    case 'FETCH_ERROR':
      return {
        ...state,
        token: null,
        loading: false,
        error: action.error,
        isJukeboxOffline: action.isJukeboxOffline
      }
    default:
      return state
  }
}

const initialState: UserTokenState = {
  token: null,
  loading: true,
  error: null,
  isJukeboxOffline: false
}

export function useUserToken(): UserTokenHookResult {
  const [state, dispatch] = useReducer(userTokenReducer, initialState)

  useEffect(() => {
    const abortController = new AbortController()

    const fetchToken = async (): Promise<void> => {
      try {
        dispatch({ type: 'FETCH_START' })

        const response = await fetch('/api/token', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'include',
          signal: abortController.signal
        })

        if (!response.ok) {
          try {
            const errorDataRaw = await response.json()
            const parseResult = safeParseTokenErrorResponse(errorDataRaw)

            if (parseResult.success) {
              const errorData = parseResult.data
              const errorMessage =
                errorData.error || 'Failed to retrieve Spotify token'

              // Determine if jukebox is offline based on error codes
              const isOffline =
                (errorData.code &&
                  OFFLINE_ERROR_CODES.includes(
                    errorData.code as OfflineErrorCode
                  )) ||
                response.status >= 500

              dispatch({
                type: 'FETCH_ERROR',
                error: errorMessage,
                isJukeboxOffline: isOffline
              })
            } else {
              // Invalid error response format
              dispatch({
                type: 'FETCH_ERROR',
                error: `Invalid error response format from server (status: ${response.status})`,
                isJukeboxOffline: response.status >= 500
              })
            }
          } catch (parseError) {
            // Failed to parse error response as JSON
            const parseErrorMessage =
              parseError instanceof Error
                ? parseError.message
                : 'Unknown parse error'
            dispatch({
              type: 'FETCH_ERROR',
              error: `Failed to parse error response (status: ${response.status}): ${parseErrorMessage}`,
              isJukeboxOffline: response.status >= 500
            })
          }
          return
        }

        try {
          const dataRaw = await response.json()
          const parseResult = safeParseTokenResponse(dataRaw)

          if (parseResult.success) {
            dispatch({
              type: 'FETCH_SUCCESS',
              token: parseResult.data.access_token
            })
          } else {
            dispatch({
              type: 'FETCH_ERROR',
              error: `Invalid token response format: ${parseResult.error.message}`,
              isJukeboxOffline: true
            })
          }
        } catch (parseError) {
          // Failed to parse response as JSON
          const parseErrorMessage =
            parseError instanceof Error
              ? parseError.message
              : 'Unknown parse error'
          dispatch({
            type: 'FETCH_ERROR',
            error: `Failed to parse token response: ${parseErrorMessage}`,
            isJukeboxOffline: true
          })
        }
      } catch (err) {
        // Handle AbortError silently (component unmounted)
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }

        // Network or system errors indicate jukebox is offline
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to retrieve token'
        dispatch({
          type: 'FETCH_ERROR',
          error: errorMessage,
          isJukeboxOffline: true
        })
      }
    }

    void fetchToken()

    return () => {
      abortController.abort()
    }
  }, [])

  return {
    token: state.token,
    loading: state.loading,
    error: state.error,
    isJukeboxOffline: state.isJukeboxOffline
  }
}
