export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          metadata: Json
          organization_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          metadata?: Json
          organization_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          error: string | null
          event_type: string
          id: string
          payload_minimal: Json
          processed_at: string | null
          provider: string
          provider_event_id: string
          received_at: string
          state: string
        }
        Insert: {
          error?: string | null
          event_type: string
          id?: string
          payload_minimal?: Json
          processed_at?: string | null
          provider?: string
          provider_event_id: string
          received_at?: string
          state?: string
        }
        Update: {
          error?: string | null
          event_type?: string
          id?: string
          payload_minimal?: Json
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          received_at?: string
          state?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          contact_phone: string
          created_at: string
          display_name: string
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          contact_phone: string
          created_at?: string
          display_name: string
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          contact_phone?: string
          created_at?: string
          display_name?: string
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          name_snapshot: string
          order_id: string
          organization_id: string
          product_id: string | null
          quantity: number
          subtotal_cents: number | null
          unit_price_cents: number | null
          unit_snapshot: string
        }
        Insert: {
          created_at?: string
          id?: string
          name_snapshot: string
          order_id: string
          organization_id: string
          product_id?: string | null
          quantity: number
          subtotal_cents?: number | null
          unit_price_cents?: number | null
          unit_snapshot: string
        }
        Update: {
          created_at?: string
          id?: string
          name_snapshot?: string
          order_id?: string
          organization_id?: string
          product_id?: string | null
          quantity?: number
          subtotal_cents?: number | null
          unit_price_cents?: number | null
          unit_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_fk"
            columns: ["order_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "order_items_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      order_status_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          from_status: string | null
          id: string
          order_id: string
          organization_id: string
          to_status: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          order_id: string
          organization_id: string
          to_status: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          order_id?: string
          organization_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_events_order_fk"
            columns: ["order_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      orders: {
        Row: {
          buyer_name: string | null
          buyer_phone: string | null
          created_at: string
          customer_id: string | null
          id: string
          note: string | null
          organization_id: string
          price_list_id: string | null
          price_source: string
          public_reference: string
          quote_id: string | null
          request_id: string | null
          source: string
          status: string
          total_cents: number | null
          updated_at: string
          whatsapp_opt_in: boolean
          whatsapp_opt_in_at: string | null
          whatsapp_opt_out_at: string | null
        }
        Insert: {
          buyer_name?: string | null
          buyer_phone?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          note?: string | null
          organization_id: string
          price_list_id?: string | null
          price_source?: string
          public_reference: string
          quote_id?: string | null
          request_id?: string | null
          source?: string
          status?: string
          total_cents?: number | null
          updated_at?: string
          whatsapp_opt_in?: boolean
          whatsapp_opt_in_at?: string | null
          whatsapp_opt_out_at?: string | null
        }
        Update: {
          buyer_name?: string | null
          buyer_phone?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          price_list_id?: string | null
          price_source?: string
          public_reference?: string
          quote_id?: string | null
          request_id?: string | null
          source?: string
          status?: string
          total_cents?: number | null
          updated_at?: string
          whatsapp_opt_in?: boolean
          whatsapp_opt_in_at?: string | null
          whatsapp_opt_out_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_org_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_price_list_assignments: {
        Row: {
          assigned_at: string
          customer_id: string
          id: string
          organization_id: string
          price_list_id: string
        }
        Insert: {
          assigned_at?: string
          customer_id: string
          id?: string
          organization_id: string
          price_list_id: string
        }
        Update: {
          assigned_at?: string
          customer_id?: string
          id?: string
          organization_id?: string
          price_list_id?: string
        }
        Relationships: []
      }
      customer_price_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          expires_at: string
          id: string
          organization_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          expires_at: string
          id?: string
          organization_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          expires_at?: string
          id?: string
          organization_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: []
      }
      price_list_items: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          price_cents: number
          price_list_id: string
          product_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          price_cents: number
          price_list_id: string
          product_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          price_cents?: number
          price_list_id?: string
          product_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      price_lists: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      quote_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event: string
          from_status: string | null
          id: string
          metadata: Json
          organization_id: string
          quote_id: string
          to_status: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event: string
          from_status?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          quote_id: string
          to_status?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          quote_id?: string
          to_status?: string | null
        }
        Relationships: []
      }
      quote_items: {
        Row: {
          created_at: string
          id: string
          name_snapshot: string
          organization_id: string
          price_list_id: string | null
          price_source: string
          product_id: string | null
          quantity: number
          quote_id: string
          subtotal_cents: number
          unit_price_cents: number
          unit_snapshot: string
        }
        Insert: {
          created_at?: string
          id?: string
          name_snapshot: string
          organization_id: string
          price_list_id?: string | null
          price_source?: string
          product_id?: string | null
          quantity: number
          quote_id: string
          subtotal_cents: number
          unit_price_cents: number
          unit_snapshot: string
        }
        Update: {
          created_at?: string
          id?: string
          name_snapshot?: string
          organization_id?: string
          price_list_id?: string | null
          price_source?: string
          product_id?: string | null
          quantity?: number
          quote_id?: string
          subtotal_cents?: number
          unit_price_cents?: number
          unit_snapshot?: string
        }
        Relationships: []
      }
      quote_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          organization_id: string
          quote_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          organization_id: string
          quote_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          organization_id?: string
          quote_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: []
      }
      quotes: {
        Row: {
          accepted_at: string | null
          canceled_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          declined_at: string | null
          id: string
          notes: string | null
          order_id: string | null
          organization_id: string
          price_list_id: string | null
          price_source: string
          public_reference: string
          sent_at: string | null
          status: string
          total_cents: number
          updated_at: string
          valid_until: string
          version: number
        }
        Insert: {
          accepted_at?: string | null
          canceled_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          declined_at?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          organization_id: string
          price_list_id?: string | null
          price_source?: string
          public_reference: string
          sent_at?: string | null
          status?: string
          total_cents: number
          updated_at?: string
          valid_until: string
          version?: number
        }
        Update: {
          accepted_at?: string | null
          canceled_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          declined_at?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          organization_id?: string
          price_list_id?: string | null
          price_source?: string
          public_reference?: string
          sent_at?: string | null
          status?: string
          total_cents?: number
          updated_at?: string
          valid_until?: string
          version?: number
        }
        Relationships: []
      }
      whatsapp_connections: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_error: string | null
          organization_id: string
          phone_number_id: string
          status: string
          token_ciphertext: string | null
          updated_at: string
          waba_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          organization_id: string
          phone_number_id: string
          status?: string
          token_ciphertext?: string | null
          updated_at?: string
          waba_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          organization_id?: string
          phone_number_id?: string
          status?: string
          token_ciphertext?: string | null
          updated_at?: string
          waba_id?: string
        }
        Relationships: []
      }
      whatsapp_events: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          outbox_id: string
          payload: Json
          provider_status: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          outbox_id: string
          payload?: Json
          provider_status: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          outbox_id?: string
          payload?: Json
          provider_status?: string
        }
        Relationships: []
      }
      whatsapp_outbox: {
        Row: {
          attempts: number
          blocked_reason: string | null
          created_at: string
          event: string
          id: string
          idempotency_key: string
          last_error: string | null
          next_attempt_at: string | null
          organization_id: string
          order_id: string
          payload: Json
          provider_message_id: string | null
          provider_status: string | null
          recipient_phone: string
          status: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          blocked_reason?: string | null
          created_at?: string
          event: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          next_attempt_at?: string | null
          organization_id: string
          order_id: string
          payload?: Json
          provider_message_id?: string | null
          provider_status?: string | null
          recipient_phone: string
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          blocked_reason?: string | null
          created_at?: string
          event?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          next_attempt_at?: string | null
          organization_id?: string
          order_id?: string
          payload?: Json
          provider_message_id?: string | null
          provider_status?: string | null
          recipient_phone?: string
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_templates: {
        Row: {
          created_at: string
          event: string
          id: string
          language: string
          organization_id: string
          status: string
          template_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          language?: string
          organization_id: string
          status?: string
          template_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          language?: string
          organization_id?: string
          status?: string
          template_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          access_state: string
          city: string | null
          created_at: string
          id: string
          min_order_cents: number | null
          min_order_items: number | null
          name: string
          owner_user_id: string
          slug: string
          trial_ends_at: string
          updated_at: string
          whatsapp: string
        }
        Insert: {
          access_state?: string
          city?: string | null
          created_at?: string
          id?: string
          min_order_cents?: number | null
          min_order_items?: number | null
          name: string
          owner_user_id: string
          slug: string
          trial_ends_at?: string
          updated_at?: string
          whatsapp: string
        }
        Update: {
          access_state?: string
          city?: string | null
          created_at?: string
          id?: string
          min_order_cents?: number | null
          min_order_items?: number | null
          name?: string
          owner_user_id?: string
          slug?: string
          trial_ends_at?: string
          updated_at?: string
          whatsapp?: string
        }
        Relationships: []
      }
      product_categories: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          organization_id: string
          position: number
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          organization_id: string
          position?: number
          slug?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          position?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_images: {
        Row: {
          alt_text: string
          created_at: string
          created_by: string | null
          id: string
          is_cover: boolean
          organization_id: string
          position: number
          product_id: string
          storage_path: string
          thumb_path: string | null
          updated_at: string
        }
        Insert: {
          alt_text: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_cover?: boolean
          organization_id: string
          position?: number
          product_id: string
          storage_path: string
          thumb_path?: string | null
          updated_at?: string
        }
        Update: {
          alt_text?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_cover?: boolean
          organization_id?: string
          position?: number
          product_id?: string
          storage_path?: string
          thumb_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          category_id: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
          price_cents: number | null
          sku: string | null
          min_quantity: number
          quantity_increment: number
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
          price_cents?: number | null
          sku?: string | null
          min_quantity?: number
          quantity_increment?: number
          unit: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          price_cents?: number | null
          sku?: string | null
          min_quantity?: number
          quantity_increment?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          bucket: string
          counter: number
          updated_at: string
          window_started_at: string
        }
        Insert: {
          bucket: string
          counter: number
          updated_at?: string
          window_started_at: string
        }
        Update: {
          bucket?: string
          counter?: number
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      reorder_links: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          expires_at: string
          id: string
          last_used_at: string | null
          organization_id: string
          revoked_at: string | null
          template_json: Json
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          organization_id: string
          revoked_at?: string | null
          template_json?: Json
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          organization_id?: string
          revoked_at?: string | null
          template_json?: Json
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "reorder_links_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          last_provider_event_at: string | null
          last_verified_at: string | null
          organization_id: string
          pending_plan_code: string | null
          pending_plan_effective_at: string | null
          pending_plan_version: number | null
          pending_provider_checkout_id: string | null
          plan_code: string
          plan_version: number
          provider: string
          provider_checkout_id: string | null
          provider_customer_id: string | null
          provider_subscription_id: string | null
          state: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          last_provider_event_at?: string | null
          last_verified_at?: string | null
          organization_id: string
          pending_plan_code?: string | null
          pending_plan_effective_at?: string | null
          pending_plan_version?: number | null
          pending_provider_checkout_id?: string | null
          plan_code?: string
          plan_version?: number
          provider?: string
          provider_checkout_id?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          last_provider_event_at?: string | null
          last_verified_at?: string | null
          organization_id?: string
          pending_plan_code?: string | null
          pending_plan_effective_at?: string | null
          pending_plan_version?: number | null
          pending_provider_checkout_id?: string | null
          plan_code?: string
          plan_version?: number
          provider?: string
          provider_checkout_id?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      reorder_links_safe: {
        Row: {
          created_at: string | null
          customer_id: string | null
          expires_at: string | null
          id: string | null
          last_used_at: string | null
          organization_id: string | null
          revoked_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          expires_at?: string | null
          id?: string | null
          last_used_at?: string | null
          organization_id?: string | null
          revoked_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          expires_at?: string | null
          id?: string | null
          last_used_at?: string | null
          organization_id?: string | null
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reorder_links_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
    }
    Functions: {
      create_organization: {
        Args: { p_city?: string; p_name: string; p_whatsapp: string }
        Returns: {
          access_state: string
          city: string | null
          created_at: string
          id: string
          min_order_cents: number | null
          min_order_items: number | null
          name: string
          owner_user_id: string
          slug: string
          trial_ends_at: string
          updated_at: string
          whatsapp: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      api_effective_plan: {
        Args: { p_organization_id: string }
        Returns: {
          plan_code: string
          plan_version: number
          access_kind: string
          access_until: string | null
        }[]
      }
      api_assert_entitlement: {
        Args: { p_organization_id: string; p_feature_key: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

