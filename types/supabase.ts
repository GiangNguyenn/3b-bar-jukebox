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
