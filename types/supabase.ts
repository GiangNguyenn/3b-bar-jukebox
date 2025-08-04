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
          subscription_id: string | null
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
          subscription_id?: string | null
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
          subscription_id?: string | null
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
          genre: string | null
          release_year: number | null
          duration_ms: number
          popularity: number
          spotify_url: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          spotify_track_id: string
          name: string
          artist: string
          album: string
          genre?: string | null
          release_year?: number | null
          duration_ms: number
          popularity: number
          spotify_url?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          spotify_track_id?: string
          name?: string
          artist?: string
          album?: string
          genre?: string | null
          release_year?: number | null
          duration_ms?: number
          popularity?: number
          spotify_url?: string | null
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
      branding_settings: {
        Row: {
          id: string
          profile_id: string
          logo_url: string | null
          favicon_url: string | null
          venue_name: string | null
          subtitle: string | null
          welcome_message: string | null
          footer_text: string | null
          font_family: string | null
          font_size: string | null
          font_weight: string | null
          text_color: string | null
          primary_color: string | null
          secondary_color: string | null
          background_color: string | null
          accent_color_1: string | null
          accent_color_2: string | null
          accent_color_3: string | null
          gradient_type: string | null
          gradient_direction: string | null
          gradient_stops: string | null
          page_title: string | null
          meta_description: string | null
          open_graph_title: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          logo_url?: string | null
          favicon_url?: string | null
          venue_name?: string | null
          subtitle?: string | null
          welcome_message?: string | null
          footer_text?: string | null
          font_family?: string | null
          font_size?: string | null
          font_weight?: string | null
          text_color?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          background_color?: string | null
          accent_color_1?: string | null
          accent_color_2?: string | null
          accent_color_3?: string | null
          gradient_type?: string | null
          gradient_direction?: string | null
          gradient_stops?: string | null
          page_title?: string | null
          meta_description?: string | null
          open_graph_title?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          logo_url?: string | null
          favicon_url?: string | null
          venue_name?: string | null
          subtitle?: string | null
          welcome_message?: string | null
          footer_text?: string | null
          font_family?: string | null
          font_size?: string | null
          font_weight?: string | null
          text_color?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          background_color?: string | null
          accent_color_1?: string | null
          accent_color_2?: string | null
          accent_color_3?: string | null
          gradient_type?: string | null
          gradient_direction?: string | null
          gradient_stops?: string | null
          page_title?: string | null
          meta_description?: string | null
          open_graph_title?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      subscriptions: {
        Row: {
          id: string
          profile_id: string
          stripe_subscription_id: string | null
          stripe_customer_id: string | null
          plan_type: 'free' | 'premium'
          payment_type: 'monthly' | 'lifetime'
          status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete'
          current_period_start: string | null
          current_period_end: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          stripe_subscription_id?: string | null
          stripe_customer_id?: string | null
          plan_type: 'free' | 'premium'
          payment_type: 'monthly' | 'lifetime'
          status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete'
          current_period_start?: string | null
          current_period_end?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          stripe_subscription_id?: string | null
          stripe_customer_id?: string | null
          plan_type?: 'free' | 'premium'
          payment_type?: 'monthly' | 'lifetime'
          status?: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete'
          current_period_start?: string | null
          current_period_end?: string | null
          created_at?: string
          updated_at?: string
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
