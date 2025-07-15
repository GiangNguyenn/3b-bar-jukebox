export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          created_at: string
          updated_at: string
          display_name: string
          spotify_user_id: string
          avatar_url: string | null
          spotify_access_token: string | null
          spotify_refresh_token: string | null
          spotify_token_expires_at: number | null
          spotify_provider_id: string | null
          spotify_product_type: string | null
          is_premium: boolean | null
          premium_verified_at: string | null
        }
        Insert: {
          id: string
          created_at?: string
          updated_at?: string
          display_name: string
          spotify_user_id: string
          avatar_url?: string | null
          spotify_access_token?: string | null
          spotify_refresh_token?: string | null
          spotify_token_expires_at?: number | null
          spotify_provider_id?: string | null
          spotify_product_type?: string | null
          is_premium?: boolean | null
          premium_verified_at?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          updated_at?: string
          display_name?: string
          spotify_user_id?: string
          avatar_url?: string | null
          spotify_access_token?: string | null
          spotify_refresh_token?: string | null
          spotify_token_expires_at?: number | null
          spotify_provider_id?: string | null
          spotify_product_type?: string | null
          is_premium?: boolean | null
          premium_verified_at?: string | null
        }
      }
      playlists: {
        Row: {
          id: string
          created_at: string
          updated_at: string
          user_id: string
          spotify_playlist_id: string
          name: string
        }
        Insert: {
          id?: string
          created_at?: string
          updated_at?: string
          user_id: string
          spotify_playlist_id: string
          name: string
        }
        Update: {
          id?: string
          created_at?: string
          updated_at?: string
          user_id?: string
          spotify_playlist_id?: string
          name?: string
        }
      }
      tracks: {
        Row: {
          id: string
          created_at: string
          spotify_track_id: string
          name: string
          artist: string
          album: string
          duration_ms: number
          popularity: number
          spotify_uri: string
        }
        Insert: {
          id?: string
          created_at?: string
          spotify_track_id: string
          name: string
          artist: string
          album: string
          duration_ms: number
          popularity: number
          spotify_uri: string
        }
        Update: {
          id?: string
          created_at?: string
          spotify_track_id?: string
          name?: string
          artist?: string
          album?: string
          duration_ms?: number
          popularity?: number
          spotify_uri?: string
        }
      }
      jukebox_queue: {
        Row: {
          id: string
          created_at: string
          profile_id: string
          track_id: string
          votes: number
          queued_at: string
        }
        Insert: {
          id?: string
          created_at?: string
          profile_id: string
          track_id: string
          votes?: number
          queued_at?: string
        }
        Update: {
          id?: string
          created_at?: string
          profile_id?: string
          track_id?: string
          votes?: number
          queued_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
