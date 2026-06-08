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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: number
          ip_address: unknown
          payload: Json | null
          target_id: string | null
          target_type: string | null
          tenant_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: number
          ip_address?: unknown
          payload?: Json | null
          target_id?: string | null
          target_type?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: number
          ip_address?: unknown
          payload?: Json | null
          target_id?: string | null
          target_type?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          active_script_id: string | null
          archived_at: string | null
          cities: string[] | null
          created_at: string
          daily_limit: number
          filters: Json | null
          hour_window_end: number
          hour_window_start: number
          id: string
          name: string
          neighborhoods: string[] | null
          profession: Database["public"]["Enums"]["Profession"]
          status: Database["public"]["Enums"]["CampaignStatus"]
          tenant_id: string
          total_captured: number
          total_closed_won: number
          total_conversing: number
          total_scheduled: number
          updated_at: string
        }
        Insert: {
          active_script_id?: string | null
          archived_at?: string | null
          cities?: string[] | null
          created_at?: string
          daily_limit?: number
          filters?: Json | null
          hour_window_end?: number
          hour_window_start?: number
          id: string
          name: string
          neighborhoods?: string[] | null
          profession: Database["public"]["Enums"]["Profession"]
          status?: Database["public"]["Enums"]["CampaignStatus"]
          tenant_id: string
          total_captured?: number
          total_closed_won?: number
          total_conversing?: number
          total_scheduled?: number
          updated_at: string
        }
        Update: {
          active_script_id?: string | null
          archived_at?: string | null
          cities?: string[] | null
          created_at?: string
          daily_limit?: number
          filters?: Json | null
          hour_window_end?: number
          hour_window_start?: number
          id?: string
          name?: string
          neighborhoods?: string[] | null
          profession?: Database["public"]["Enums"]["Profession"]
          status?: Database["public"]["Enums"]["CampaignStatus"]
          tenant_id?: string
          total_captured?: number
          total_closed_won?: number
          total_conversing?: number
          total_scheduled?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_active_script_id_fkey"
            columns: ["active_script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ai_handling: boolean
          closed_at: string | null
          current_node_id: string | null
          escalated_reason: string | null
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_outbound_at: string | null
          lead_id: string
          message_count: number
          script_id: string | null
          started_at: string
          status: Database["public"]["Enums"]["ConversationStatus"]
          tenant_id: string
        }
        Insert: {
          ai_handling?: boolean
          closed_at?: string | null
          current_node_id?: string | null
          escalated_reason?: string | null
          id: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          lead_id: string
          message_count?: number
          script_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["ConversationStatus"]
          tenant_id: string
        }
        Update: {
          ai_handling?: boolean
          closed_at?: string | null
          current_node_id?: string | null
          escalated_reason?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          lead_id?: string
          message_count?: number
          script_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["ConversationStatus"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          key: string
          reason: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled: boolean
          id: string
          key: string
          reason?: string | null
          tenant_id?: string | null
          updated_at: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          key?: string
          reason?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      health_profiles: {
        Row: {
          bmi_calculated: number | null
          collected_at: string
          continuous_medication: string | null
          estimated_premium_max_cents: number | null
          estimated_premium_min_cents: number | null
          family_history: Json | null
          height_cm: number | null
          lead_id: string
          physical_activity: string | null
          pre_existing_diseases: string | null
          recent_surgery: boolean | null
          risk_category: string | null
          smoker: boolean | null
          tenant_id: string
          updated_at: string
          weight_kg: number | null
        }
        Insert: {
          bmi_calculated?: number | null
          collected_at?: string
          continuous_medication?: string | null
          estimated_premium_max_cents?: number | null
          estimated_premium_min_cents?: number | null
          family_history?: Json | null
          height_cm?: number | null
          lead_id: string
          physical_activity?: string | null
          pre_existing_diseases?: string | null
          recent_surgery?: boolean | null
          risk_category?: string | null
          smoker?: boolean | null
          tenant_id: string
          updated_at: string
          weight_kg?: number | null
        }
        Update: {
          bmi_calculated?: number | null
          collected_at?: string
          continuous_medication?: string | null
          estimated_premium_max_cents?: number | null
          estimated_premium_min_cents?: number | null
          family_history?: Json | null
          height_cm?: number | null
          lead_id?: string
          physical_activity?: string | null
          pre_existing_diseases?: string | null
          recent_surgery?: boolean | null
          risk_category?: string | null
          smoker?: boolean | null
          tenant_id?: string
          updated_at?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "health_profiles_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          endpoint: string
          expires_at: string
          key: string
          response_cache: Json | null
          status_code: number | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          endpoint: string
          expires_at: string
          key: string
          response_cache?: Json | null
          status_code?: number | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          endpoint?: string
          expires_at?: string
          key?: string
          response_cache?: Json | null
          status_code?: number | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: number
          lead_id: string
          payload: Json | null
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: number
          lead_id: string
          payload?: Json | null
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: number
          lead_id?: string
          payload?: Json | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_notes: {
        Row: {
          author_id: string | null
          content: string
          created_at: string
          id: string
          lead_id: string
          tenant_id: string
        }
        Insert: {
          author_id?: string | null
          content: string
          created_at?: string
          id: string
          lead_id: string
          tenant_id: string
        }
        Update: {
          author_id?: string | null
          content?: string
          created_at?: string
          id?: string
          lead_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: Json | null
          age_estimate: number | null
          campaign_id: string | null
          closed_at: string | null
          contacted_at: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          first_response_at: string | null
          fit_score: number | null
          google_rating: number | null
          google_reviews_count: number | null
          id: string
          metadata: Json | null
          name: string | null
          partner_or_owner: boolean | null
          pipeline_stage: string | null
          profession: Database["public"]["Enums"]["Profession"] | null
          qualified_at: string | null
          registration_number: string | null
          source: Database["public"]["Enums"]["LeadSource"]
          source_external_id: string | null
          source_raw_data: Json | null
          status: Database["public"]["Enums"]["LeadStatus"]
          tags: string[] | null
          tenant_id: string
          updated_at: string
          whatsapp: string
          whatsapp_valid: boolean | null
          years_of_practice: number | null
        }
        Insert: {
          address?: Json | null
          age_estimate?: number | null
          campaign_id?: string | null
          closed_at?: string | null
          contacted_at?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_response_at?: string | null
          fit_score?: number | null
          google_rating?: number | null
          google_reviews_count?: number | null
          id: string
          metadata?: Json | null
          name?: string | null
          partner_or_owner?: boolean | null
          pipeline_stage?: string | null
          profession?: Database["public"]["Enums"]["Profession"] | null
          qualified_at?: string | null
          registration_number?: string | null
          source: Database["public"]["Enums"]["LeadSource"]
          source_external_id?: string | null
          source_raw_data?: Json | null
          status?: Database["public"]["Enums"]["LeadStatus"]
          tags?: string[] | null
          tenant_id: string
          updated_at: string
          whatsapp: string
          whatsapp_valid?: boolean | null
          years_of_practice?: number | null
        }
        Update: {
          address?: Json | null
          age_estimate?: number | null
          campaign_id?: string | null
          closed_at?: string | null
          contacted_at?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_response_at?: string | null
          fit_score?: number | null
          google_rating?: number | null
          google_reviews_count?: number | null
          id?: string
          metadata?: Json | null
          name?: string | null
          partner_or_owner?: boolean | null
          pipeline_stage?: string | null
          profession?: Database["public"]["Enums"]["Profession"] | null
          qualified_at?: string | null
          registration_number?: string | null
          source?: Database["public"]["Enums"]["LeadSource"]
          source_external_id?: string | null
          source_raw_data?: Json | null
          status?: Database["public"]["Enums"]["LeadStatus"]
          tags?: string[] | null
          tenant_id?: string
          updated_at?: string
          whatsapp?: string
          whatsapp_valid?: boolean | null
          years_of_practice?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lgpd_requests: {
        Row: {
          created_at: string
          download_expires_at: string | null
          download_url: string | null
          id: string
          processed_at: string | null
          processed_by_id: string | null
          rejection_reason: string | null
          requested_by_lead: string | null
          requested_by_user_id: string | null
          scope: Json | null
          status: Database["public"]["Enums"]["LgpdRequestStatus"]
          tenant_id: string
          type: Database["public"]["Enums"]["LgpdRequestType"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          download_expires_at?: string | null
          download_url?: string | null
          id: string
          processed_at?: string | null
          processed_by_id?: string | null
          rejection_reason?: string | null
          requested_by_lead?: string | null
          requested_by_user_id?: string | null
          scope?: Json | null
          status?: Database["public"]["Enums"]["LgpdRequestStatus"]
          tenant_id: string
          type: Database["public"]["Enums"]["LgpdRequestType"]
          updated_at: string
        }
        Update: {
          created_at?: string
          download_expires_at?: string | null
          download_url?: string | null
          id?: string
          processed_at?: string | null
          processed_by_id?: string | null
          rejection_reason?: string | null
          requested_by_lead?: string | null
          requested_by_user_id?: string | null
          scope?: Json | null
          status?: Database["public"]["Enums"]["LgpdRequestStatus"]
          tenant_id?: string
          type?: Database["public"]["Enums"]["LgpdRequestType"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lgpd_requests_processed_by_id_fkey"
            columns: ["processed_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lgpd_requests_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lgpd_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          attendees: Json | null
          commission_cents: number | null
          conversation_id: string | null
          created_at: string
          duration_minutes: number
          google_event_id: string | null
          id: string
          lead_id: string
          location: string | null
          notes: string | null
          outcome: Database["public"]["Enums"]["MeetingOutcome"] | null
          outcome_marked_at: string | null
          policy_value_cents: number | null
          referrals_collected: Json | null
          referrals_count: number
          rescheduled_from_id: string | null
          scheduled_for: string
          status: Database["public"]["Enums"]["MeetingStatus"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attendees?: Json | null
          commission_cents?: number | null
          conversation_id?: string | null
          created_at?: string
          duration_minutes?: number
          google_event_id?: string | null
          id: string
          lead_id: string
          location?: string | null
          notes?: string | null
          outcome?: Database["public"]["Enums"]["MeetingOutcome"] | null
          outcome_marked_at?: string | null
          policy_value_cents?: number | null
          referrals_collected?: Json | null
          referrals_count?: number
          rescheduled_from_id?: string | null
          scheduled_for: string
          status?: Database["public"]["Enums"]["MeetingStatus"]
          tenant_id: string
          updated_at: string
        }
        Update: {
          attendees?: Json | null
          commission_cents?: number | null
          conversation_id?: string | null
          created_at?: string
          duration_minutes?: number
          google_event_id?: string | null
          id?: string
          lead_id?: string
          location?: string | null
          notes?: string | null
          outcome?: Database["public"]["Enums"]["MeetingOutcome"] | null
          outcome_marked_at?: string | null
          policy_value_cents?: number | null
          referrals_collected?: Json | null
          referrals_count?: number
          rescheduled_from_id?: string | null
          scheduled_for?: string
          status?: Database["public"]["Enums"]["MeetingStatus"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_rescheduled_from_id_fkey"
            columns: ["rescheduled_from_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          delivered_at: string | null
          delivery_status:
            | Database["public"]["Enums"]["MessageDeliveryStatus"]
            | null
          direction: Database["public"]["Enums"]["MessageDirection"]
          failed_reason: string | null
          id: string
          intent_confidence: number | null
          intent_detected: string | null
          llm_cost_cents: number | null
          llm_latency_ms: number | null
          llm_model: string | null
          llm_tokens_input: number | null
          llm_tokens_output: number | null
          read_at: string | null
          script_id: string | null
          script_node_id: string | null
          script_variation_id: string | null
          sender: Database["public"]["Enums"]["MessageSender"]
          tenant_id: string
          whatsapp_message_id: string | null
          media_url: string | null
          media_type: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          delivery_status?:
            | Database["public"]["Enums"]["MessageDeliveryStatus"]
            | null
          direction: Database["public"]["Enums"]["MessageDirection"]
          failed_reason?: string | null
          id: string
          intent_confidence?: number | null
          intent_detected?: string | null
          llm_cost_cents?: number | null
          llm_latency_ms?: number | null
          llm_model?: string | null
          llm_tokens_input?: number | null
          llm_tokens_output?: number | null
          read_at?: string | null
          script_id?: string | null
          script_node_id?: string | null
          script_variation_id?: string | null
          sender: Database["public"]["Enums"]["MessageSender"]
          tenant_id: string
          whatsapp_message_id?: string | null
          media_url?: string | null
          media_type?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          delivery_status?:
            | Database["public"]["Enums"]["MessageDeliveryStatus"]
            | null
          direction?: Database["public"]["Enums"]["MessageDirection"]
          failed_reason?: string | null
          id?: string
          intent_confidence?: number | null
          intent_detected?: string | null
          llm_cost_cents?: number | null
          llm_latency_ms?: number | null
          llm_model?: string | null
          llm_tokens_input?: number | null
          llm_tokens_output?: number | null
          read_at?: string | null
          script_id?: string | null
          script_node_id?: string | null
          script_variation_id?: string | null
          sender?: Database["public"]["Enums"]["MessageSender"]
          tenant_id?: string
          whatsapp_message_id?: string | null
          media_url?: string | null
          media_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channels: Database["public"]["Enums"]["NotificationChannel"][] | null
          enabled: boolean
          event_type: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channels?: Database["public"]["Enums"]["NotificationChannel"][] | null
          enabled?: boolean
          event_type: string
          id: string
          updated_at: string
          user_id: string
        }
        Update: {
          channels?: Database["public"]["Enums"]["NotificationChannel"][] | null
          enabled?: boolean
          event_type?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          data: Json | null
          id: string
          link: string | null
          read_at: string | null
          tenant_id: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json | null
          id: string
          link?: string | null
          read_at?: string | null
          tenant_id: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json | null
          id?: string
          link?: string | null
          read_at?: string | null
          tenant_id?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_alerts: {
        Row: {
          ack_at: string | null
          ack_by_id: string | null
          context: Json | null
          created_at: string
          dedup_key: string | null
          id: string
          message: string
          resolved_at: string | null
          severity: Database["public"]["Enums"]["AlertSeverity"]
          tenant_id: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          ack_at?: string | null
          ack_by_id?: string | null
          context?: Json | null
          created_at?: string
          dedup_key?: string | null
          id: string
          message: string
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["AlertSeverity"]
          tenant_id?: string | null
          title: string
          type: string
          updated_at: string
        }
        Update: {
          ack_at?: string | null
          ack_by_id?: string | null
          context?: Json | null
          created_at?: string
          dedup_key?: string | null
          id?: string
          message?: string
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["AlertSeverity"]
          tenant_id?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_alerts_ack_by_id_fkey"
            columns: ["ack_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      optouts: {
        Row: {
          created_at: string
          reason: string | null
          source: string | null
          tenant_id: string
          whatsapp: string
        }
        Insert: {
          created_at?: string
          reason?: string | null
          source?: string | null
          tenant_id: string
          whatsapp: string
        }
        Update: {
          created_at?: string
          reason?: string | null
          source?: string | null
          tenant_id?: string
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "optouts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_outbound: {
        Row: {
          attempts: number
          content: string
          conversation_id: string
          created_at: string
          failed_at: string | null
          failed_reason: string | null
          id: string
          idempotency_key: string
          scheduled_for: string
          sent_at: string | null
          tenant_id: string
          media_url: string | null
          media_type: string | null
        }
        Insert: {
          attempts?: number
          content: string
          conversation_id: string
          created_at?: string
          failed_at?: string | null
          failed_reason?: string | null
          id: string
          idempotency_key: string
          scheduled_for: string
          sent_at?: string | null
          tenant_id: string
          media_url?: string | null
          media_type?: string | null
        }
        Update: {
          attempts?: number
          content?: string
          conversation_id?: string
          created_at?: string
          failed_at?: string | null
          failed_reason?: string | null
          id?: string
          idempotency_key?: string
          scheduled_for?: string
          sent_at?: string | null
          tenant_id?: string
          media_url?: string | null
          media_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_outbound_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          activated_at: string | null
          created_at: string
          created_by_id: string | null
          deprecated_at: string | null
          id: string
          is_active: boolean
          notes: string | null
          prompt_type: Database["public"]["Enums"]["PromptType"]
          template: string
          tenant_id: string | null
          test_cases: Json | null
          variables_required: Json | null
          version: number
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          created_by_id?: string | null
          deprecated_at?: string | null
          id: string
          is_active?: boolean
          notes?: string | null
          prompt_type: Database["public"]["Enums"]["PromptType"]
          template: string
          tenant_id?: string | null
          test_cases?: Json | null
          variables_required?: Json | null
          version?: number
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          created_by_id?: string | null
          deprecated_at?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          prompt_type?: Database["public"]["Enums"]["PromptType"]
          template?: string
          tenant_id?: string | null
          test_cases?: Json | null
          variables_required?: Json | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      script_templates: {
        Row: {
          active: boolean
          base_message_template: string | null
          category: Database["public"]["Enums"]["ScriptCategory"]
          created_at: string
          description: string | null
          flow_template: Json
          id: string
          name: string
          popularity: number
          segment: string
          target_profession: Database["public"]["Enums"]["Profession"] | null
          updated_at: string
          variables: string[] | null
        }
        Insert: {
          active?: boolean
          base_message_template?: string | null
          category: Database["public"]["Enums"]["ScriptCategory"]
          created_at?: string
          description?: string | null
          flow_template: Json
          id: string
          name: string
          popularity?: number
          segment: string
          target_profession?: Database["public"]["Enums"]["Profession"] | null
          updated_at: string
          variables?: string[] | null
        }
        Update: {
          active?: boolean
          base_message_template?: string | null
          category?: Database["public"]["Enums"]["ScriptCategory"]
          created_at?: string
          description?: string | null
          flow_template?: Json
          id?: string
          name?: string
          popularity?: number
          segment?: string
          target_profession?: Database["public"]["Enums"]["Profession"] | null
          updated_at?: string
          variables?: string[] | null
        }
        Relationships: []
      }
      script_variations: {
        Row: {
          active: boolean
          conversion_rate: number | null
          created_at: string
          id: string
          message: string
          response_rate: number | null
          script_id: string
          tenant_id: string
          total_converted: number
          total_responded: number
          total_sent: number
          updated_at: string
          variant_letter: string
          weight: number
        }
        Insert: {
          active?: boolean
          conversion_rate?: number | null
          created_at?: string
          id: string
          message: string
          response_rate?: number | null
          script_id: string
          tenant_id: string
          total_converted?: number
          total_responded?: number
          total_sent?: number
          updated_at: string
          variant_letter: string
          weight?: number
        }
        Update: {
          active?: boolean
          conversion_rate?: number | null
          created_at?: string
          id?: string
          message?: string
          response_rate?: number | null
          script_id?: string
          tenant_id?: string
          total_converted?: number
          total_responded?: number
          total_sent?: number
          updated_at?: string
          variant_letter?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "script_variations_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_variations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scripts: {
        Row: {
          archived_at: string | null
          base_message: string | null
          category: Database["public"]["Enums"]["ScriptCategory"]
          ai_instructions: string | null
          ai_tools: string[] | null
          cloned_from_template_id: string | null
          conversion_rate: number | null
          created_at: string
          flow: Json | null
          id: string
          name: string
          response_rate: number | null
          status: Database["public"]["Enums"]["ScriptStatus"]
          target_profession: Database["public"]["Enums"]["Profession"] | null
          tenant_id: string
          total_usages: number
          updated_at: string
          variables: string[] | null
        }
        Insert: {
          archived_at?: string | null
          base_message?: string | null
          category: Database["public"]["Enums"]["ScriptCategory"]
          ai_instructions?: string | null
          ai_tools?: string[] | null
          cloned_from_template_id?: string | null
          conversion_rate?: number | null
          created_at?: string
          flow?: Json | null
          id: string
          name: string
          response_rate?: number | null
          status?: Database["public"]["Enums"]["ScriptStatus"]
          target_profession?: Database["public"]["Enums"]["Profession"] | null
          tenant_id: string
          total_usages?: number
          updated_at: string
          variables?: string[] | null
        }
        Update: {
          archived_at?: string | null
          base_message?: string | null
          category?: Database["public"]["Enums"]["ScriptCategory"]
          ai_instructions?: string | null
          ai_tools?: string[] | null
          cloned_from_template_id?: string | null
          conversion_rate?: number | null
          created_at?: string
          flow?: Json | null
          id?: string
          name?: string
          response_rate?: number | null
          status?: Database["public"]["Enums"]["ScriptStatus"]
          target_profession?: Database["public"]["Enums"]["Profession"] | null
          tenant_id?: string
          total_usages?: number
          updated_at?: string
          variables?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "scripts_cloned_from_template_id_fkey"
            columns: ["cloned_from_template_id"]
            isOneToOne: false
            referencedRelation: "script_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scripts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          ip_address: unknown
          refresh_token: string
          revoked_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id: string
          ip_address?: unknown
          refresh_token: string
          revoked_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          refresh_token?: string
          revoked_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_ai_configs: {
        Row: {
          classifier_model: string | null
          classifier_provider: string | null
          classifier_temperature: number
          fallback_chain: Json | null
          guardrail_model: string | null
          guardrail_provider: string | null
          max_output_tokens: number
          system_model: string | null
          system_provider: string | null
          system_temperature: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          classifier_model?: string | null
          classifier_provider?: string | null
          classifier_temperature?: number
          fallback_chain?: Json | null
          guardrail_model?: string | null
          guardrail_provider?: string | null
          max_output_tokens?: number
          system_model?: string | null
          system_provider?: string | null
          system_temperature?: number
          tenant_id: string
          updated_at: string
        }
        Update: {
          classifier_model?: string | null
          classifier_provider?: string | null
          classifier_temperature?: number
          fallback_chain?: Json | null
          guardrail_model?: string | null
          guardrail_provider?: string | null
          max_output_tokens?: number
          system_model?: string | null
          system_provider?: string | null
          system_temperature?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_ai_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_billing: {
        Row: {
          created_at: string
          due_at: string
          excess_cents: number
          external_invoice_id: string | null
          id: string
          invoice_url: string | null
          mrr_cents: number
          paid_at: string | null
          payment_method: string | null
          period_month: string
          status: Database["public"]["Enums"]["BillingStatus"]
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          due_at: string
          excess_cents?: number
          external_invoice_id?: string | null
          id: string
          invoice_url?: string | null
          mrr_cents: number
          paid_at?: string | null
          payment_method?: string | null
          period_month: string
          status?: Database["public"]["Enums"]["BillingStatus"]
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        Update: {
          created_at?: string
          due_at?: string
          excess_cents?: number
          external_invoice_id?: string | null
          id?: string
          invoice_url?: string | null
          mrr_cents?: number
          paid_at?: string | null
          payment_method?: string | null
          period_month?: string
          status?: Database["public"]["Enums"]["BillingStatus"]
          tenant_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_billing_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_discoveries: {
        Row: {
          approval_proof_r2_key: string | null
          approved_at: string | null
          attachments: Json | null
          audio_r2_key: string | null
          conducted_at: string | null
          created_at: string
          notes: string | null
          pm_user_id: string | null
          scheduled_for: string | null
          scripts_draft: Json | null
          status: Database["public"]["Enums"]["DiscoveryStatus"]
          tenant_id: string
          transcript_r2_key: string | null
          updated_at: string
          validated_at: string | null
          validation_rounds: number
          video_r2_key: string | null
          voice_profile_draft: Json | null
        }
        Insert: {
          approval_proof_r2_key?: string | null
          approved_at?: string | null
          attachments?: Json | null
          audio_r2_key?: string | null
          conducted_at?: string | null
          created_at?: string
          notes?: string | null
          pm_user_id?: string | null
          scheduled_for?: string | null
          scripts_draft?: Json | null
          status?: Database["public"]["Enums"]["DiscoveryStatus"]
          tenant_id: string
          transcript_r2_key?: string | null
          updated_at: string
          validated_at?: string | null
          validation_rounds?: number
          video_r2_key?: string | null
          voice_profile_draft?: Json | null
        }
        Update: {
          approval_proof_r2_key?: string | null
          approved_at?: string | null
          attachments?: Json | null
          audio_r2_key?: string | null
          conducted_at?: string | null
          created_at?: string
          notes?: string | null
          pm_user_id?: string | null
          scheduled_for?: string | null
          scripts_draft?: Json | null
          status?: Database["public"]["Enums"]["DiscoveryStatus"]
          tenant_id?: string
          transcript_r2_key?: string | null
          updated_at?: string
          validated_at?: string | null
          validation_rounds?: number
          video_r2_key?: string | null
          voice_profile_draft?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_discoveries_pm_user_id_fkey"
            columns: ["pm_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_discoveries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_invitations: {
        Row: {
          code: string
          created_at: string
          created_by_id: string
          expires_at: string
          id: string
          notes: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["UserRole"]
          tenant_id: string
          used_at: string | null
          used_by_user_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by_id: string
          expires_at: string
          id: string
          notes?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["UserRole"]
          tenant_id: string
          used_at?: string | null
          used_by_user_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by_id?: string
          expires_at?: string
          id?: string
          notes?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["UserRole"]
          tenant_id?: string
          used_at?: string | null
          used_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_notes: {
        Row: {
          author_id: string | null
          category: string | null
          content: string
          created_at: string
          id: string
          tenant_id: string
        }
        Insert: {
          author_id?: string | null
          category?: string | null
          content: string
          created_at?: string
          id: string
          tenant_id: string
        }
        Update: {
          author_id?: string | null
          category?: string | null
          content?: string
          created_at?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_secrets: {
        Row: {
          ai_provider: Database["public"]["Enums"]["AIProvider"]
          anthropic_api_key_encrypted: string | null
          evolution_api_key_encrypted: string | null
          evolution_base_url: string | null
          evolution_instance_name: string | null
          evolution_webhook_secret: string | null
          firecrawl_api_key_encrypted: string | null
          google_ai_api_key_encrypted: string | null
          google_calendar_id: string | null
          google_maps_api_key_encrypted: string | null
          google_oauth_refresh_encrypted: string | null
          google_oauth_scope: string | null
          openai_api_key_encrypted: string | null
          tavily_api_key_encrypted: string | null
          tenant_id: string
          twilio_account_sid_encrypted: string | null
          twilio_auth_token_encrypted: string | null
          updated_at: string
        }
        Insert: {
          ai_provider?: Database["public"]["Enums"]["AIProvider"]
          anthropic_api_key_encrypted?: string | null
          evolution_api_key_encrypted?: string | null
          evolution_base_url?: string | null
          evolution_instance_name?: string | null
          evolution_webhook_secret?: string | null
          firecrawl_api_key_encrypted?: string | null
          google_ai_api_key_encrypted?: string | null
          google_calendar_id?: string | null
          google_maps_api_key_encrypted?: string | null
          google_oauth_refresh_encrypted?: string | null
          google_oauth_scope?: string | null
          openai_api_key_encrypted?: string | null
          tavily_api_key_encrypted?: string | null
          tenant_id: string
          twilio_account_sid_encrypted?: string | null
          twilio_auth_token_encrypted?: string | null
          updated_at: string
        }
        Update: {
          ai_provider?: Database["public"]["Enums"]["AIProvider"]
          anthropic_api_key_encrypted?: string | null
          evolution_api_key_encrypted?: string | null
          evolution_base_url?: string | null
          evolution_instance_name?: string | null
          evolution_webhook_secret?: string | null
          firecrawl_api_key_encrypted?: string | null
          google_ai_api_key_encrypted?: string | null
          google_calendar_id?: string | null
          google_maps_api_key_encrypted?: string | null
          google_oauth_refresh_encrypted?: string | null
          google_oauth_scope?: string | null
          openai_api_key_encrypted?: string | null
          tavily_api_key_encrypted?: string | null
          tenant_id?: string
          twilio_account_sid_encrypted?: string | null
          twilio_auth_token_encrypted?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_secrets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_usage: {
        Row: {
          conversations_started: number
          google_maps_calls: number
          google_maps_cost_cents: number
          id: number
          leads_captured_count: number
          llm_cost_cents: number
          llm_tokens_input: number
          llm_tokens_output: number
          meetings_closed: number
          meetings_scheduled: number
          period_month: string
          tenant_id: string
          updated_at: string
          whatsapp_cost_cents: number
          whatsapp_messages_sent: number
        }
        Insert: {
          conversations_started?: number
          google_maps_calls?: number
          google_maps_cost_cents?: number
          id?: number
          leads_captured_count?: number
          llm_cost_cents?: number
          llm_tokens_input?: number
          llm_tokens_output?: number
          meetings_closed?: number
          meetings_scheduled?: number
          period_month: string
          tenant_id: string
          updated_at: string
          whatsapp_cost_cents?: number
          whatsapp_messages_sent?: number
        }
        Update: {
          conversations_started?: number
          google_maps_calls?: number
          google_maps_cost_cents?: number
          id?: number
          leads_captured_count?: number
          llm_cost_cents?: number
          llm_tokens_input?: number
          llm_tokens_output?: number
          meetings_closed?: number
          meetings_scheduled?: number
          period_month?: string
          tenant_id?: string
          updated_at?: string
          whatsapp_cost_cents?: number
          whatsapp_messages_sent?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_usage_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          ai_voice_profile: Json | null
          brand_logo_url: string | null
          brand_primary_color: string | null
          contract_signed_at: string | null
          created_at: string
          custom_domain: string | null
          deleted_at: string | null
          go_live_at: string | null
          high_value_areas: string[] | null
          id: string
          mrr_cents: number
          name: string
          plan: Database["public"]["Enums"]["TenantPlan"]
          segment: string | null
          setup_paid_cents: number | null
          slug: string
          status: Database["public"]["Enums"]["TenantStatus"]
          updated_at: string
          whatsapp_warmup_day: number
          whatsapp_warmup_started_at: string | null
        }
        Insert: {
          ai_voice_profile?: Json | null
          brand_logo_url?: string | null
          brand_primary_color?: string | null
          contract_signed_at?: string | null
          created_at?: string
          custom_domain?: string | null
          deleted_at?: string | null
          go_live_at?: string | null
          high_value_areas?: string[] | null
          id: string
          mrr_cents: number
          name: string
          plan: Database["public"]["Enums"]["TenantPlan"]
          segment?: string | null
          setup_paid_cents?: number | null
          slug: string
          status: Database["public"]["Enums"]["TenantStatus"]
          updated_at: string
          whatsapp_warmup_day?: number
          whatsapp_warmup_started_at?: string | null
        }
        Update: {
          ai_voice_profile?: Json | null
          brand_logo_url?: string | null
          brand_primary_color?: string | null
          contract_signed_at?: string | null
          created_at?: string
          custom_domain?: string | null
          deleted_at?: string | null
          go_live_at?: string | null
          high_value_areas?: string[] | null
          id?: string
          mrr_cents?: number
          name?: string
          plan?: Database["public"]["Enums"]["TenantPlan"]
          segment?: string | null
          setup_paid_cents?: number | null
          slug?: string
          status?: Database["public"]["Enums"]["TenantStatus"]
          updated_at?: string
          whatsapp_warmup_day?: number
          whatsapp_warmup_started_at?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar_url: string | null
          bio: string | null
          city: string | null
          created_at: string
          deleted_at: string | null
          email: string
          id: string
          last_login_at: string | null
          name: string
          partner_brand: string | null
          partner_code: string | null
          password_hash: string | null
          preferences: Json | null
          role: Database["public"]["Enums"]["UserRole"]
          susep: string | null
          tenant_id: string | null
          updated_at: string
          whatsapp: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          deleted_at?: string | null
          email: string
          id: string
          last_login_at?: string | null
          name: string
          partner_brand?: string | null
          partner_code?: string | null
          password_hash?: string | null
          preferences?: Json | null
          role: Database["public"]["Enums"]["UserRole"]
          susep?: string | null
          tenant_id?: string | null
          updated_at: string
          whatsapp: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string
          id?: string
          last_login_at?: string | null
          name?: string
          partner_brand?: string | null
          partner_code?: string | null
          password_hash?: string | null
          preferences?: Json | null
          role?: Database["public"]["Enums"]["UserRole"]
          susep?: string | null
          tenant_id?: string | null
          updated_at?: string
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_tenant_id: { Args: never; Returns: string }
      current_user_role: { Args: never; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      AIProvider: "GUILDS_SHARED" | "TENANT_OWN"
      AlertSeverity: "INFO" | "WARNING" | "CRITICAL"
      BillingStatus: "PENDING" | "PAID" | "OVERDUE" | "REFUNDED" | "WAIVED"
      CampaignStatus: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED"
      ConversationStatus: "ACTIVE" | "PAUSED" | "ESCALATED" | "CLOSED"
      DiscoveryStatus:
        | "NOT_STARTED"
        | "SCHEDULED"
        | "IN_SESSION"
        | "CONSOLIDATING"
        | "VALIDATING"
        | "APPROVED"
        | "CHURNED_BEFORE_APPROVAL"
      LeadSource:
        | "GOOGLE_MAPS"
        | "RECEITA_FEDERAL"
        | "CRM_SP"
        | "OAB_SP"
        | "CRO_SP"
        | "LINKEDIN"
        | "REFERRAL"
        | "LANDING_PAGE"
        | "MANUAL"
        | "IMPORTED"
      LeadStatus:
        | "CAPTURED"
        | "ENRICHED"
        | "CONTACTED"
        | "NO_RESPONSE"
        | "CONVERSING"
        | "QUALIFIED"
        | "MEETING_SCHEDULED"
        | "CLOSED_WON"
        | "CLOSED_LOST"
        | "NOT_INTERESTED"
        | "LOST_BEFORE_MEETING"
        | "OPTED_OUT"
        | "ARCHIVED"
        | "ESCALATED_HUMAN"
      LgpdRequestStatus:
        | "PENDING"
        | "PROCESSING"
        | "COMPLETED"
        | "REJECTED"
        | "CANCELED"
      LgpdRequestType:
        | "EXPORT_DATA"
        | "DELETE_TENANT_DATA"
        | "DELETE_LEAD_DATA"
        | "CORRECT_DATA"
        | "CONFIRM_DATA"
      MeetingOutcome:
        | "CLOSED"
        | "SECOND_MEETING"
        | "NOT_INTERESTED"
        | "THINKING"
      MeetingStatus:
        | "SCHEDULED"
        | "CONFIRMED"
        | "HAPPENED"
        | "NO_SHOW"
        | "RESCHEDULED"
        | "CANCELLED"
      MessageDeliveryStatus: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED"
      MessageDirection: "INBOUND" | "OUTBOUND"
      MessageSender: "AI" | "USER" | "LEAD"
      NotificationChannel: "PUSH" | "WHATSAPP" | "EMAIL" | "SMS"
      Profession:
        | "DOCTOR"
        | "LAWYER"
        | "DENTIST"
        | "ENTREPRENEUR"
        | "ENGINEER"
        | "ARCHITECT"
        | "ACCOUNTANT"
        | "OTHER"
      PromptType: "SYSTEM" | "CLASSIFIER" | "GUARDRAIL_CORRECTIVE" | "FOLLOW_UP"
      ScriptCategory:
        | "APPROACH"
        | "OBJECTION"
        | "EDUCATION"
        | "CLOSING"
        | "FOLLOW_UP"
        | "REFERRAL"
        | "REACTIVATION"
      ScriptStatus: "DRAFT" | "ACTIVE" | "ARCHIVED"
      TenantPlan: "STARTER" | "STANDARD" | "PREMIUM"
      TenantStatus:
        | "ONBOARDING"
        | "ACTIVE"
        | "SUSPENDED"
        | "CHURNING"
        | "CHURNED"
      UserRole: "OWNER" | "ASSISTANT" | "GUILDS_ADMIN"
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
    Enums: {
      AIProvider: ["GUILDS_SHARED", "TENANT_OWN"],
      AlertSeverity: ["INFO", "WARNING", "CRITICAL"],
      BillingStatus: ["PENDING", "PAID", "OVERDUE", "REFUNDED", "WAIVED"],
      CampaignStatus: ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"],
      ConversationStatus: ["ACTIVE", "PAUSED", "ESCALATED", "CLOSED"],
      DiscoveryStatus: [
        "NOT_STARTED",
        "SCHEDULED",
        "IN_SESSION",
        "CONSOLIDATING",
        "VALIDATING",
        "APPROVED",
        "CHURNED_BEFORE_APPROVAL",
      ],
      LeadSource: [
        "GOOGLE_MAPS",
        "RECEITA_FEDERAL",
        "CRM_SP",
        "OAB_SP",
        "CRO_SP",
        "LINKEDIN",
        "REFERRAL",
        "LANDING_PAGE",
        "MANUAL",
        "IMPORTED",
      ],
      LeadStatus: [
        "CAPTURED",
        "ENRICHED",
        "CONTACTED",
        "NO_RESPONSE",
        "CONVERSING",
        "QUALIFIED",
        "MEETING_SCHEDULED",
        "CLOSED_WON",
        "CLOSED_LOST",
        "NOT_INTERESTED",
        "LOST_BEFORE_MEETING",
        "OPTED_OUT",
        "ARCHIVED",
        "ESCALATED_HUMAN",
      ],
      LgpdRequestStatus: [
        "PENDING",
        "PROCESSING",
        "COMPLETED",
        "REJECTED",
        "CANCELED",
      ],
      LgpdRequestType: [
        "EXPORT_DATA",
        "DELETE_TENANT_DATA",
        "DELETE_LEAD_DATA",
        "CORRECT_DATA",
        "CONFIRM_DATA",
      ],
      MeetingOutcome: [
        "CLOSED",
        "SECOND_MEETING",
        "NOT_INTERESTED",
        "THINKING",
      ],
      MeetingStatus: [
        "SCHEDULED",
        "CONFIRMED",
        "HAPPENED",
        "NO_SHOW",
        "RESCHEDULED",
        "CANCELLED",
      ],
      MessageDeliveryStatus: ["QUEUED", "SENT", "DELIVERED", "READ", "FAILED"],
      MessageDirection: ["INBOUND", "OUTBOUND"],
      MessageSender: ["AI", "USER", "LEAD"],
      NotificationChannel: ["PUSH", "WHATSAPP", "EMAIL", "SMS"],
      Profession: [
        "DOCTOR",
        "LAWYER",
        "DENTIST",
        "ENTREPRENEUR",
        "ENGINEER",
        "ARCHITECT",
        "ACCOUNTANT",
        "OTHER",
      ],
      PromptType: ["SYSTEM", "CLASSIFIER", "GUARDRAIL_CORRECTIVE", "FOLLOW_UP"],
      ScriptCategory: [
        "APPROACH",
        "OBJECTION",
        "EDUCATION",
        "CLOSING",
        "FOLLOW_UP",
        "REFERRAL",
        "REACTIVATION",
      ],
      ScriptStatus: ["DRAFT", "ACTIVE", "ARCHIVED"],
      TenantPlan: ["STARTER", "STANDARD", "PREMIUM"],
      TenantStatus: [
        "ONBOARDING",
        "ACTIVE",
        "SUSPENDED",
        "CHURNING",
        "CHURNED",
      ],
      UserRole: ["OWNER", "ASSISTANT", "GUILDS_ADMIN"],
    },
  },
} as const
