export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '12.2.3 (519615d)'
  }
  public: {
    Tables: {
      artist_relationships: {
        Row: {
          cached_at: string | null
          id: string
          related_spotify_artist_id: string
          source_spotify_artist_id: string
        }
        Insert: {
          cached_at?: string | null
          id?: string
          related_spotify_artist_id: string
          source_spotify_artist_id: string
        }
        Update: {
          cached_at?: string | null
          id?: string
          related_spotify_artist_id?: string
          source_spotify_artist_id?: string
        }
        Relationships: []
      }
      artist_top_tracks: {
        Row: {
          cached_at: string | null
          id: string
          rank: number
          spotify_artist_id: string
          spotify_track_id: string
        }
        Insert: {
          cached_at?: string | null
          id?: string
          rank: number
          spotify_artist_id: string
          spotify_track_id: string
        }
        Update: {
          cached_at?: string | null
          id?: string
          rank?: number
          spotify_artist_id?: string
          spotify_track_id?: string
        }
        Relationships: []
      }
      artists: {
        Row: {
          cached_at: string | null
          follower_count: number | null
          genres: string[] | null
          id: string
          name: string
          popularity: number | null
          spotify_artist_id: string
        }
        Insert: {
          cached_at?: string | null
          follower_count?: number | null
          genres?: string[] | null
          id?: string
          name: string
          popularity?: number | null
          spotify_artist_id: string
        }
        Update: {
          cached_at?: string | null
          follower_count?: number | null
          genres?: string[] | null
          id?: string
          name?: string
          popularity?: number | null
          spotify_artist_id?: string
        }
        Relationships: []
      }
      branding_settings: {
        Row: {
          accent_color_1: string | null
          accent_color_2: string | null
          accent_color_3: string | null
          background_color: string | null
          created_at: string
          favicon_url: string | null
          font_family: string | null
          font_size: string | null
          font_weight: string | null
          footer_text: string | null
          gradient_direction: string | null
          gradient_stops: string | null
          gradient_type: string | null
          id: string
          logo_url: string | null
          meta_description: string | null
          open_graph_title: string | null
          page_title: string | null
          primary_color: string | null
          profile_id: string
          secondary_color: string | null
          subtitle: string | null
          text_color: string | null
          updated_at: string
          venue_name: string | null
          welcome_message: string | null
        }
        Insert: {
          accent_color_1?: string | null
          accent_color_2?: string | null
          accent_color_3?: string | null
          background_color?: string | null
          created_at?: string
          favicon_url?: string | null
          font_family?: string | null
          font_size?: string | null
          font_weight?: string | null
          footer_text?: string | null
          gradient_direction?: string | null
          gradient_stops?: string | null
          gradient_type?: string | null
          id?: string
          logo_url?: string | null
          meta_description?: string | null
          open_graph_title?: string | null
          page_title?: string | null
          primary_color?: string | null
          profile_id: string
          secondary_color?: string | null
          subtitle?: string | null
          text_color?: string | null
          updated_at?: string
          venue_name?: string | null
          welcome_message?: string | null
        }
        Update: {
          accent_color_1?: string | null
          accent_color_2?: string | null
          accent_color_3?: string | null
          background_color?: string | null
          created_at?: string
          favicon_url?: string | null
          font_family?: string | null
          font_size?: string | null
          font_weight?: string | null
          footer_text?: string | null
          gradient_direction?: string | null
          gradient_stops?: string | null
          gradient_type?: string | null
          id?: string
          logo_url?: string | null
          meta_description?: string | null
          open_graph_title?: string | null
          page_title?: string | null
          primary_color?: string | null
          profile_id?: string
          secondary_color?: string | null
          subtitle?: string | null
          text_color?: string | null
          updated_at?: string
          venue_name?: string | null
          welcome_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'branding_settings_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'branding_settings_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: true
            referencedRelation: 'profiles_public'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'branding_settings_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: true
            referencedRelation: 'user_subscription_summary'
            referencedColumns: ['profile_id']
          }
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          match_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'conversations_match_id_fkey'
            columns: ['match_id']
            isOneToOne: true
            referencedRelation: 'matches'
            referencedColumns: ['id']
          }
        ]
      }
      jukebox_queue: {
        Row: {
          id: string
          profile_id: string
          queued_at: string
          track_id: string
          votes: number
        }
        Insert: {
          id?: string
          profile_id: string
          queued_at?: string
          track_id: string
          votes?: number
        }
        Update: {
          id?: string
          profile_id?: string
          queued_at?: string
          track_id?: string
          votes?: number
        }
        Relationships: [
          {
            foreignKeyName: 'jukebox_queue_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'jukebox_queue_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles_public'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'jukebox_queue_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'user_subscription_summary'
            referencedColumns: ['profile_id']
          },
          {
            foreignKeyName: 'jukebox_queue_track_id_fkey'
            columns: ['track_id']
            isOneToOne: false
            referencedRelation: 'tracks'
            referencedColumns: ['id']
          }
        ]
      }
      likes: {
        Row: {
          action: string
          created_at: string
          id: string
          liked_id: string
          liker_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          liked_id: string
          liker_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          liked_id?: string
          liker_id?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          created_at: string
          id: string
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          id?: string
          user_a?: string
          user_b?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          }
        ]
      }
      playlists: {
        Row: {
          created_at: string
          id: string
          name: string
          spotify_playlist_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          spotify_playlist_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          spotify_playlist_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_preferences: {
        Row: {
          communication_preference: string[] | null
          created_at: string | null
          desires: string[] | null
          discretion_assurance: string | null
          discretion_level:
            | Database['public']['Enums']['discretion_level_type']
            | null
          disposable_income:
            | Database['public']['Enums']['disposable_income_type']
            | null
          expectations: string[] | null
          lifestyle_interests: string[] | null
          long_distance_ok: boolean | null
          marital_status: string | null
          max_age: number | null
          meeting_frequency:
            | Database['public']['Enums']['meeting_frequency_type']
            | null
          meeting_preference:
            | Database['public']['Enums']['meeting_preference_type']
            | null
          min_age: number | null
          preferred_genders: string[] | null
          preferred_sexualities: string[] | null
          respect_consent_language: string | null
          travel_schedule: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          communication_preference?: string[] | null
          created_at?: string | null
          desires?: string[] | null
          discretion_assurance?: string | null
          discretion_level?:
            | Database['public']['Enums']['discretion_level_type']
            | null
          disposable_income?:
            | Database['public']['Enums']['disposable_income_type']
            | null
          expectations?: string[] | null
          lifestyle_interests?: string[] | null
          long_distance_ok?: boolean | null
          marital_status?: string | null
          max_age?: number | null
          meeting_frequency?:
            | Database['public']['Enums']['meeting_frequency_type']
            | null
          meeting_preference?:
            | Database['public']['Enums']['meeting_preference_type']
            | null
          min_age?: number | null
          preferred_genders?: string[] | null
          preferred_sexualities?: string[] | null
          respect_consent_language?: string | null
          travel_schedule?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          communication_preference?: string[] | null
          created_at?: string | null
          desires?: string[] | null
          discretion_assurance?: string | null
          discretion_level?:
            | Database['public']['Enums']['discretion_level_type']
            | null
          disposable_income?:
            | Database['public']['Enums']['disposable_income_type']
            | null
          expectations?: string[] | null
          lifestyle_interests?: string[] | null
          long_distance_ok?: boolean | null
          marital_status?: string | null
          max_age?: number | null
          meeting_frequency?:
            | Database['public']['Enums']['meeting_frequency_type']
            | null
          meeting_preference?:
            | Database['public']['Enums']['meeting_preference_type']
            | null
          min_age?: number | null
          preferred_genders?: string[] | null
          preferred_sexualities?: string[] | null
          respect_consent_language?: string | null
          travel_schedule?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          is_premium: boolean | null
          premium_verified_at: string | null
          spotify_access_token: string | null
          spotify_product_type: string | null
          spotify_provider_id: string | null
          spotify_refresh_token: string | null
          spotify_token_expires_at: number | null
          spotify_user_id: string
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          is_premium?: boolean | null
          premium_verified_at?: string | null
          spotify_access_token?: string | null
          spotify_product_type?: string | null
          spotify_provider_id?: string | null
          spotify_refresh_token?: string | null
          spotify_token_expires_at?: number | null
          spotify_user_id: string
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_premium?: boolean | null
          premium_verified_at?: string | null
          spotify_access_token?: string | null
          spotify_product_type?: string | null
          spotify_provider_id?: string | null
          spotify_refresh_token?: string | null
          spotify_token_expires_at?: number | null
          spotify_user_id?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_subscription_id_fkey'
            columns: ['subscription_id']
            isOneToOne: false
            referencedRelation: 'subscriptions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_subscription_id_fkey'
            columns: ['subscription_id']
            isOneToOne: false
            referencedRelation: 'user_subscription_summary'
            referencedColumns: ['subscription_id']
          }
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          payment_type: string
          plan_type: string
          profile_id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          payment_type: string
          plan_type: string
          profile_id: string
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          payment_type?: string
          plan_type?: string
          profile_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'subscriptions_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'subscriptions_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles_public'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'subscriptions_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'user_subscription_summary'
            referencedColumns: ['profile_id']
          }
        ]
      }
      suggested_tracks: {
        Row: {
          count: number
          first_suggested_at: string
          last_suggested_at: string
          profile_id: string
          track_id: string
        }
        Insert: {
          count?: number
          first_suggested_at: string
          last_suggested_at: string
          profile_id: string
          track_id: string
        }
        Update: {
          count?: number
          first_suggested_at?: string
          last_suggested_at?: string
          profile_id?: string
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'suggested_tracks_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'suggested_tracks_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles_public'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'suggested_tracks_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'user_subscription_summary'
            referencedColumns: ['profile_id']
          },
          {
            foreignKeyName: 'suggested_tracks_track_id_fkey'
            columns: ['track_id']
            isOneToOne: false
            referencedRelation: 'tracks'
            referencedColumns: ['id']
          }
        ]
      }
      tracks: {
        Row: {
          album: string
          artist: string
          created_at: string
          duration_ms: number
          genre: string | null
          id: string
          name: string
          popularity: number
          release_year: number | null
          spotify_track_id: string
          spotify_url: string | null
        }
        Insert: {
          album: string
          artist: string
          created_at?: string
          duration_ms: number
          genre?: string | null
          id?: string
          name: string
          popularity: number
          release_year?: number | null
          spotify_track_id: string
          spotify_url?: string | null
        }
        Update: {
          album?: string
          artist?: string
          created_at?: string
          duration_ms?: number
          genre?: string | null
          id?: string
          name?: string
          popularity?: number
          release_year?: number | null
          spotify_track_id?: string
          spotify_url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      profiles_public: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          id: string | null
          is_premium: boolean | null
          premium_verified_at: string | null
          spotify_product_type: string | null
          spotify_user_id: string | null
          subscription_id: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          is_premium?: boolean | null
          premium_verified_at?: string | null
          spotify_product_type?: string | null
          spotify_user_id?: string | null
          subscription_id?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          is_premium?: boolean | null
          premium_verified_at?: string | null
          spotify_product_type?: string | null
          spotify_user_id?: string | null
          subscription_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_subscription_id_fkey'
            columns: ['subscription_id']
            isOneToOne: false
            referencedRelation: 'subscriptions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_subscription_id_fkey'
            columns: ['subscription_id']
            isOneToOne: false
            referencedRelation: 'user_subscription_summary'
            referencedColumns: ['subscription_id']
          }
        ]
      }
      user_subscription_summary: {
        Row: {
          current_period_end: string | null
          current_period_start: string | null
          display_name: string | null
          payment_type: string | null
          plan_type: string | null
          profile_id: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_created_at: string | null
          subscription_id: string | null
          subscription_updated_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_premium_access: {
        Args: { user_profile_id: string }
        Returns: boolean
      }
      exec_sql: { Args: { params?: string[]; sql: string }; Returns: Json }
      get_admin_spotify_credentials: {
        Args: Record<PropertyKey, never>
        Returns: {
          id: string
          spotify_access_token: string
          spotify_refresh_token: string
          spotify_token_expires_at: number
        }[]
      }
      get_track_popularity_histogram: {
        Args: { p_user_id: string }
        Returns: {
          popularity_range: string
          track_count: number
        }[]
      }
      get_track_release_year_histogram: {
        Args: { p_user_id: string }
        Returns: {
          decade: string
          track_count: number
        }[]
      }
      get_user_plan_type: { Args: { user_profile_id: string }; Returns: string }
      get_user_plan_type_optimized: {
        Args: { user_profile_id: string }
        Returns: string
      }
      get_user_spotify_tokens: {
        Args: { user_id: string }
        Returns: {
          spotify_access_token: string
          spotify_provider_id: string
          spotify_refresh_token: string
          spotify_token_expires_at: number
        }[]
      }
      get_user_subscription_details: {
        Args: { user_profile_id: string }
        Returns: {
          current_period_end: string
          payment_type: string
          plan_type: string
          status: string
          stripe_subscription_id: string
        }[]
      }
      get_user_subscription_status: {
        Args: { user_profile_id: string }
        Returns: {
          current_period_end: string
          has_premium_access: boolean
          payment_type: string
          plan_type: string
          profile_id: string
          status: string
        }[]
      }
      has_premium_access: {
        Args: { user_profile_id: string }
        Returns: boolean
      }
      log_track_suggestion:
        | {
            Args: {
              p_album_name: string
              p_artist_name: string
              p_duration_ms: number
              p_popularity: number
              p_profile_id: string
              p_spotify_track_id: string
              p_spotify_url: string
              p_track_name: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_album_name: string
              p_artist_name: string
              p_duration_ms: number
              p_genre: string
              p_popularity: number
              p_profile_id: string
              p_release_year: number
              p_spotify_track_id: string
              p_spotify_url: string
              p_track_name: string
            }
            Returns: undefined
          }
      refresh_user_subscription_summary: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      rpc_get_dating_feed: {
        Args: { preferences?: Json; radius_km?: number; viewer_user_id: string }
        Returns: {
          age: number
          alias: string
          bio: string
          desires: string[]
          discretion_level: string
          disposable_income: string
          distance_km: number
          gender: string
          interests: string
          lifestyle_interests: string[]
          location: string
          long_distance_ok: boolean
          meeting_frequency: string
          meeting_preference: string
          primary_photo_path: string
          profile_type: string
          sexuality: string
          trust_score: number
          trust_votes_count: number
          user_id: string
          verification_status: string
          verified_photos_count: number
        }[]
      }
      rpc_like: {
        Args: { v_action: string; v_liker_id: string; v_target_id: string }
        Returns: undefined
      }
      update_user_spotify_tokens: {
        Args: {
          access_token?: string
          expires_at?: number
          provider_id?: string
          refresh_token?: string
          user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      discretion_level_type: 'high' | 'medium' | 'low'
      disposable_income_type:
        | 'under_1k'
        | '1k_3k'
        | '3k_5k'
        | '5k_10k'
        | '10k_plus'
      gender_type:
        | 'man'
        | 'woman'
        | 'non_binary'
        | 'trans_man'
        | 'trans_woman'
        | 'genderqueer'
        | 'agender'
        | 'questioning'
        | 'prefer_not_to_say'
      meeting_frequency_type: 'flexible' | 'weekly' | 'biweekly' | 'monthly'
      meeting_preference_type: 'public_only' | 'private_ok'
      profile_type: 'recipient' | 'provider'
      sexuality_type:
        | 'straight'
        | 'gay'
        | 'lesbian'
        | 'bisexual'
        | 'pansexual'
        | 'asexual'
        | 'queer'
        | 'questioning'
        | 'demisexual'
        | 'prefer_not_to_say'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      discretion_level_type: ['high', 'medium', 'low'],
      disposable_income_type: [
        'under_1k',
        '1k_3k',
        '3k_5k',
        '5k_10k',
        '10k_plus'
      ],
      gender_type: [
        'man',
        'woman',
        'non_binary',
        'trans_man',
        'trans_woman',
        'genderqueer',
        'agender',
        'questioning',
        'prefer_not_to_say'
      ],
      meeting_frequency_type: ['flexible', 'weekly', 'biweekly', 'monthly'],
      meeting_preference_type: ['public_only', 'private_ok'],
      profile_type: ['recipient', 'provider'],
      sexuality_type: [
        'straight',
        'gay',
        'lesbian',
        'bisexual',
        'pansexual',
        'asexual',
        'queer',
        'questioning',
        'demisexual',
        'prefer_not_to_say'
      ]
    }
  }
} as const
