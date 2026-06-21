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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      accounting_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          period_month: string
          status: Database["public"]["Enums"]["accounting_period_status"]
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          period_month: string
          status?: Database["public"]["Enums"]["accounting_period_status"]
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          period_month?: string
          status?: Database["public"]["Enums"]["accounting_period_status"]
        }
        Relationships: [
          {
            foreignKeyName: "accounting_periods_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          comment: string | null
          decided_at: string
          decided_by: string
          decision: Database["public"]["Enums"]["approval_decision"]
          id: string
          work_package_id: string
        }
        Insert: {
          comment?: string | null
          decided_at?: string
          decided_by: string
          decision: Database["public"]["Enums"]["approval_decision"]
          id?: string
          work_package_id: string
        }
        Update: {
          comment?: string | null
          decided_at?: string
          decided_by?: string
          decision?: Database["public"]["Enums"]["approval_decision"]
          id?: string
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          client_ts: string | null
          created_at: string
          id: string
          payload: Json | null
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          client_ts?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          client_ts?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: []
      }
      client_billings: {
        Row: {
          billing_no: number
          certified_at: string | null
          certified_by: string | null
          created_at: string
          created_by: string
          gross_amount: number
          id: string
          net_receivable: number | null
          note: string | null
          period_from: string | null
          period_to: string | null
          project_id: string
          retention_amount: number | null
          retention_rate: number
          status: Database["public"]["Enums"]["client_billing_status"]
          updated_at: string
          vat_amount: number | null
          vat_rate: number
          wht_rate: number
          wht_suffered: number | null
        }
        Insert: {
          billing_no?: number
          certified_at?: string | null
          certified_by?: string | null
          created_at?: string
          created_by: string
          gross_amount: number
          id?: string
          net_receivable?: number | null
          note?: string | null
          period_from?: string | null
          period_to?: string | null
          project_id: string
          retention_amount?: number | null
          retention_rate?: number
          status?: Database["public"]["Enums"]["client_billing_status"]
          updated_at?: string
          vat_amount?: number | null
          vat_rate?: number
          wht_rate?: number
          wht_suffered?: number | null
        }
        Update: {
          billing_no?: number
          certified_at?: string | null
          certified_by?: string | null
          created_at?: string
          created_by?: string
          gross_amount?: number
          id?: string
          net_receivable?: number | null
          note?: string | null
          period_from?: string | null
          period_to?: string | null
          project_id?: string
          retention_amount?: number | null
          retention_rate?: number
          status?: Database["public"]["Enums"]["client_billing_status"]
          updated_at?: string
          vat_amount?: number | null
          vat_rate?: number
          wht_rate?: number
          wht_suffered?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_billings_certified_by_fkey"
            columns: ["certified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_billings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_billings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          contact_person: string | null
          created_at: string
          created_by: string
          email: string | null
          id: string
          mailing_address: string | null
          name: string
          note: string | null
          phone: string | null
        }
        Insert: {
          contact_person?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          mailing_address?: string | null
          name: string
          note?: string | null
          phone?: string | null
        }
        Update: {
          contact_person?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          mailing_address?: string | null
          name?: string
          note?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coin_confiscations: {
        Row: {
          amount: number
          confiscated_at: string
          confiscated_by: string
          id: string
          note: string | null
          posting_id: string
          reason: Database["public"]["Enums"]["confiscation_reason"]
          worker_id: string
        }
        Insert: {
          amount: number
          confiscated_at?: string
          confiscated_by: string
          id?: string
          note?: string | null
          posting_id: string
          reason: Database["public"]["Enums"]["confiscation_reason"]
          worker_id: string
        }
        Update: {
          amount?: number
          confiscated_at?: string
          confiscated_by?: string
          id?: string
          note?: string | null
          posting_id?: string
          reason?: Database["public"]["Enums"]["confiscation_reason"]
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coin_confiscations_confiscated_by_fkey"
            columns: ["confiscated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coin_confiscations_posting_id_fkey"
            columns: ["posting_id"]
            isOneToOne: false
            referencedRelation: "coin_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coin_confiscations_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      coin_postings: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          occurred_at: string
          reason: string
          source: Database["public"]["Enums"]["coin_source"]
          source_project_id: string | null
          worker_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          occurred_at?: string
          reason: string
          source: Database["public"]["Enums"]["coin_source"]
          source_project_id?: string | null
          worker_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          occurred_at?: string
          reason?: string
          source?: Database["public"]["Enums"]["coin_source"]
          source_project_id?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coin_postings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coin_postings_source_project_id_fkey"
            columns: ["source_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coin_postings_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_attachments: {
        Row: {
          contractor_id: string | null
          created_at: string
          id: string
          purpose: Database["public"]["Enums"]["contact_doc_purpose"]
          service_provider_id: string | null
          storage_path: string
          supplier_id: string | null
          uploaded_by: string
        }
        Insert: {
          contractor_id?: string | null
          created_at?: string
          id?: string
          purpose: Database["public"]["Enums"]["contact_doc_purpose"]
          service_provider_id?: string | null
          storage_path: string
          supplier_id?: string | null
          uploaded_by: string
        }
        Update: {
          contractor_id?: string | null
          created_at?: string
          id?: string
          purpose?: Database["public"]["Enums"]["contact_doc_purpose"]
          service_provider_id?: string | null
          storage_path?: string
          supplier_id?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_attachments_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_attachments_service_provider_id_fkey"
            columns: ["service_provider_id"]
            isOneToOne: false
            referencedRelation: "service_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_attachments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_bank: {
        Row: {
          bank_account_name: string | null
          bank_account_no: string | null
          bank_name: string | null
          contractor_id: string | null
          id: string
          service_provider_id: string | null
          supplier_id: string | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          bank_account_name?: string | null
          bank_account_no?: string | null
          bank_name?: string | null
          contractor_id?: string | null
          id?: string
          service_provider_id?: string | null
          supplier_id?: string | null
          updated_at?: string
          updated_by: string
        }
        Update: {
          bank_account_name?: string | null
          bank_account_no?: string | null
          bank_name?: string | null
          contractor_id?: string | null
          id?: string
          service_provider_id?: string | null
          supplier_id?: string | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_bank_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_bank_service_provider_id_fkey"
            columns: ["service_provider_id"]
            isOneToOne: false
            referencedRelation: "service_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_bank_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_bank_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_bank_change_requests: {
        Row: {
          bank_account_name: string | null
          bank_account_no: string | null
          bank_name: string | null
          contractor_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          requested_by: string
          status: Database["public"]["Enums"]["contractor_change_status"]
        }
        Insert: {
          bank_account_name?: string | null
          bank_account_no?: string | null
          bank_name?: string | null
          contractor_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          requested_by: string
          status?: Database["public"]["Enums"]["contractor_change_status"]
        }
        Update: {
          bank_account_name?: string | null
          bank_account_no?: string | null
          bank_name?: string | null
          contractor_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          requested_by?: string
          status?: Database["public"]["Enums"]["contractor_change_status"]
        }
        Relationships: [
          {
            foreignKeyName: "contractor_bank_change_requests_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_bank_change_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_bank_change_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_consents: {
        Row: {
          consented_at: string
          contractor_id: string
          created_at: string
          document_id: string | null
          id: string
          kind: Database["public"]["Enums"]["contractor_consent_kind"]
          recorded_by: string
          revoked_at: string | null
        }
        Insert: {
          consented_at?: string
          contractor_id: string
          created_at?: string
          document_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["contractor_consent_kind"]
          recorded_by: string
          revoked_at?: string | null
        }
        Update: {
          consented_at?: string
          contractor_id?: string
          created_at?: string
          document_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["contractor_consent_kind"]
          recorded_by?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractor_consents_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_consents_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_invites: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          contractor_id: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          token: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          contractor_id: string
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          token: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          contractor_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_invites_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_invites_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_users: {
        Row: {
          contractor_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_users_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contractors: {
        Row: {
          contact_person: string | null
          contractor_category: Database["public"]["Enums"]["contractor_category"]
          contractor_subtype:
            | Database["public"]["Enums"]["contractor_subtype"]
            | null
          created_at: string
          created_by: string
          date_of_birth: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relation: string | null
          id: string
          mailing_address: string | null
          name: string
          note: string | null
          phone: string | null
          specialty: string | null
          status: Database["public"]["Enums"]["contact_status"]
          tax_id: string | null
        }
        Insert: {
          contact_person?: string | null
          contractor_category?: Database["public"]["Enums"]["contractor_category"]
          contractor_subtype?:
            | Database["public"]["Enums"]["contractor_subtype"]
            | null
          created_at?: string
          created_by: string
          date_of_birth?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          id?: string
          mailing_address?: string | null
          name: string
          note?: string | null
          phone?: string | null
          specialty?: string | null
          status?: Database["public"]["Enums"]["contact_status"]
          tax_id?: string | null
        }
        Update: {
          contact_person?: string | null
          contractor_category?: Database["public"]["Enums"]["contractor_category"]
          contractor_subtype?:
            | Database["public"]["Enums"]["contractor_subtype"]
            | null
          created_at?: string
          created_by?: string
          date_of_birth?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          id?: string
          mailing_address?: string | null
          name?: string
          note?: string | null
          phone?: string | null
          specialty?: string | null
          status?: Database["public"]["Enums"]["contact_status"]
          tax_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dc_payments: {
        Row: {
          computed_amount: number
          computed_days: number
          contractor_id: string
          correction_reason: string | null
          created_at: string
          id: string
          method: Database["public"]["Enums"]["dc_payment_method"]
          note: string | null
          paid_amount: number | null
          paid_at: string
          paid_by: string
          period_from: string
          period_to: string
          reference: string | null
          superseded_by: string | null
        }
        Insert: {
          computed_amount: number
          computed_days: number
          contractor_id: string
          correction_reason?: string | null
          created_at?: string
          id?: string
          method: Database["public"]["Enums"]["dc_payment_method"]
          note?: string | null
          paid_amount?: number | null
          paid_at: string
          paid_by: string
          period_from: string
          period_to: string
          reference?: string | null
          superseded_by?: string | null
        }
        Update: {
          computed_amount?: number
          computed_days?: number
          contractor_id?: string
          correction_reason?: string | null
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["dc_payment_method"]
          note?: string | null
          paid_amount?: number | null
          paid_at?: string
          paid_by?: string
          period_from?: string
          period_to?: string
          reference?: string | null
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dc_payments_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dc_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dc_payments_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "dc_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      deliverables: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          project_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          project_id: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliverables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_categories: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "equipment_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_items: {
        Row: {
          acquired_at: string | null
          acquisition_cost: number | null
          asset_tag: string | null
          category_id: string
          created_at: string
          created_by: string
          daily_rate: number | null
          id: string
          name: string
          owner_id: string
          quantity: number | null
          status: Database["public"]["Enums"]["equipment_status"]
          tracking: Database["public"]["Enums"]["equipment_tracking"]
        }
        Insert: {
          acquired_at?: string | null
          acquisition_cost?: number | null
          asset_tag?: string | null
          category_id: string
          created_at?: string
          created_by: string
          daily_rate?: number | null
          id?: string
          name: string
          owner_id: string
          quantity?: number | null
          status?: Database["public"]["Enums"]["equipment_status"]
          tracking?: Database["public"]["Enums"]["equipment_tracking"]
        }
        Update: {
          acquired_at?: string | null
          acquisition_cost?: number | null
          asset_tag?: string | null
          category_id?: string
          created_at?: string
          created_by?: string
          daily_rate?: number | null
          id?: string
          name?: string
          owner_id?: string
          quantity?: number | null
          status?: Database["public"]["Enums"]["equipment_status"]
          tracking?: Database["public"]["Enums"]["equipment_tracking"]
        }
        Relationships: [
          {
            foreignKeyName: "equipment_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "equipment_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_items_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "equipment_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_movements: {
        Row: {
          created_at: string
          created_by: string
          id: string
          item_id: string
          kind: Database["public"]["Enums"]["equipment_movement_kind"]
          note: string | null
          occurred_at: string
          project_id: string | null
          quantity: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          item_id: string
          kind: Database["public"]["Enums"]["equipment_movement_kind"]
          note?: string | null
          occurred_at?: string
          project_id?: string | null
          quantity?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          item_id?: string
          kind?: Database["public"]["Enums"]["equipment_movement_kind"]
          note?: string | null
          occurred_at?: string
          project_id?: string | null
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "equipment_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "equipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_owners: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_owners_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_project_allocations: {
        Row: {
          batch_id: string
          created_at: string
          created_by: string
          ends_on: string | null
          id: string
          note: string | null
          project_id: string
          starts_on: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          created_by: string
          ends_on?: string | null
          id?: string
          note?: string | null
          project_id: string
          starts_on: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          created_by?: string
          ends_on?: string | null
          id?: string
          note?: string | null
          project_id?: string
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_project_allocations_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "equipment_rental_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_project_allocations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_project_allocations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_rental_batches: {
        Row: {
          created_at: string
          created_by: string
          ends_on: string | null
          id: string
          monthly_rate: number
          note: string | null
          owner_id: string
          starts_on: string
        }
        Insert: {
          created_at?: string
          created_by: string
          ends_on?: string | null
          id?: string
          monthly_rate: number
          note?: string | null
          owner_id: string
          starts_on: string
        }
        Update: {
          created_at?: string
          created_by?: string
          ends_on?: string | null
          id?: string
          monthly_rate?: number
          note?: string | null
          owner_id?: string
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_rental_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_rental_batches_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "equipment_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_usage_logs: {
        Row: {
          checked_in_on: string | null
          checked_out_on: string
          correction_reason: string | null
          created_at: string
          daily_rate_snapshot: number
          entered_by: string
          id: string
          item_id: string
          superseded_by: string | null
          work_package_id: string
        }
        Insert: {
          checked_in_on?: string | null
          checked_out_on: string
          correction_reason?: string | null
          created_at?: string
          daily_rate_snapshot: number
          entered_by: string
          id?: string
          item_id: string
          superseded_by?: string | null
          work_package_id: string
        }
        Update: {
          checked_in_on?: string | null
          checked_out_on?: string
          correction_reason?: string | null
          created_at?: string
          daily_rate_snapshot?: number
          entered_by?: string
          id?: string
          item_id?: string
          superseded_by?: string | null
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_usage_logs_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_usage_logs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "equipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_usage_logs_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "equipment_usage_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_usage_logs_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["gl_account_type"]
          active: boolean
          code: string
          created_at: string
          id: string
          is_postable: boolean
          name_en: string | null
          name_th: string
          normal_side: string
          parent_id: string | null
          peak_account_code: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_type: Database["public"]["Enums"]["gl_account_type"]
          active?: boolean
          code: string
          created_at?: string
          id?: string
          is_postable?: boolean
          name_en?: string | null
          name_th: string
          normal_side: string
          parent_id?: string | null
          peak_account_code?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["gl_account_type"]
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          is_postable?: boolean
          name_en?: string | null
          name_th?: string
          normal_side?: string
          parent_id?: string | null
          peak_account_code?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gl_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_posting_outbox: {
        Row: {
          attempts: number
          created_at: string
          id: string
          journal_entry_id: string | null
          last_error: string | null
          posted_at: string | null
          source_event: string
          source_id: string
          source_table: string
          status: Database["public"]["Enums"]["gl_posting_status"]
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          last_error?: string | null
          posted_at?: string | null
          source_event: string
          source_id: string
          source_table: string
          status?: Database["public"]["Enums"]["gl_posting_status"]
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          last_error?: string | null
          posted_at?: string | null
          source_event?: string
          source_id?: string
          source_table?: string
          status?: Database["public"]["Enums"]["gl_posting_status"]
        }
        Relationships: [
          {
            foreignKeyName: "gl_posting_outbox_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          entry_date: string
          entry_no: number
          id: string
          memo: string | null
          period_id: string
          posted_at: string
          posted_by: string | null
          reversal_of: string | null
          source_event: string
          source_id: string | null
          source_table: string
          status: Database["public"]["Enums"]["journal_entry_status"]
        }
        Insert: {
          created_at?: string
          entry_date: string
          entry_no?: number
          id?: string
          memo?: string | null
          period_id: string
          posted_at?: string
          posted_by?: string | null
          reversal_of?: string | null
          source_event: string
          source_id?: string | null
          source_table: string
          status?: Database["public"]["Enums"]["journal_entry_status"]
        }
        Update: {
          created_at?: string
          entry_date?: string
          entry_no?: number
          id?: string
          memo?: string | null
          period_id?: string
          posted_at?: string
          posted_by?: string | null
          reversal_of?: string | null
          source_event?: string
          source_id?: string | null
          source_table?: string
          status?: Database["public"]["Enums"]["journal_entry_status"]
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          client_id: string | null
          contractor_id: string | null
          credit: number
          debit: number
          entry_id: string
          equipment_owner_id: string | null
          id: string
          line_no: number
          memo: string | null
          project_id: string | null
          supplier_id: string | null
          work_package_id: string | null
        }
        Insert: {
          account_id: string
          client_id?: string | null
          contractor_id?: string | null
          credit?: number
          debit?: number
          entry_id: string
          equipment_owner_id?: string | null
          id?: string
          line_no: number
          memo?: string | null
          project_id?: string | null
          supplier_id?: string | null
          work_package_id?: string | null
        }
        Update: {
          account_id?: string
          client_id?: string | null
          contractor_id?: string | null
          credit?: number
          debit?: number
          entry_id?: string
          equipment_owner_id?: string | null
          id?: string
          line_no?: number
          memo?: string | null
          project_id?: string | null
          supplier_id?: string | null
          work_package_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_equipment_owner_id_fkey"
            columns: ["equipment_owner_id"]
            isOneToOne: false
            referencedRelation: "equipment_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      labor_logs: {
        Row: {
          contractor_id_snapshot: string | null
          correction_reason: string | null
          created_at: string
          day_fraction: Database["public"]["Enums"]["day_fraction"] | null
          day_rate_snapshot: number
          entered_by: string
          id: string
          note: string | null
          self_logged: boolean
          superseded_by: string | null
          work_date: string
          work_package_id: string
          worker_id: string
          worker_name_snapshot: string
          worker_type_snapshot: Database["public"]["Enums"]["worker_type"]
        }
        Insert: {
          contractor_id_snapshot?: string | null
          correction_reason?: string | null
          created_at?: string
          day_fraction?: Database["public"]["Enums"]["day_fraction"] | null
          day_rate_snapshot: number
          entered_by: string
          id?: string
          note?: string | null
          self_logged?: boolean
          superseded_by?: string | null
          work_date: string
          work_package_id: string
          worker_id: string
          worker_name_snapshot: string
          worker_type_snapshot: Database["public"]["Enums"]["worker_type"]
        }
        Update: {
          contractor_id_snapshot?: string | null
          correction_reason?: string | null
          created_at?: string
          day_fraction?: Database["public"]["Enums"]["day_fraction"] | null
          day_rate_snapshot?: number
          entered_by?: string
          id?: string
          note?: string | null
          self_logged?: boolean
          superseded_by?: string | null
          work_date?: string
          work_package_id?: string
          worker_id?: string
          worker_name_snapshot?: string
          worker_type_snapshot?: Database["public"]["Enums"]["worker_type"]
        }
        Relationships: [
          {
            foreignKeyName: "labor_logs_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labor_logs_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "labor_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labor_logs_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labor_logs_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      login_handoffs: {
        Row: {
          created_at: string
          device_code: string
          expires_at: string
          id: string
          line_claims: Json
          state: string
          status: Database["public"]["Enums"]["login_handoff_status"]
          user_email: string | null
        }
        Insert: {
          created_at?: string
          device_code: string
          expires_at: string
          id?: string
          line_claims?: Json
          state: string
          status?: Database["public"]["Enums"]["login_handoff_status"]
          user_email?: string | null
        }
        Update: {
          created_at?: string
          device_code?: string
          expires_at?: string
          id?: string
          line_claims?: Json
          state?: string
          status?: Database["public"]["Enums"]["login_handoff_status"]
          user_email?: string | null
        }
        Relationships: []
      }
      notification_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          event_type: Database["public"]["Enums"]["notification_event_type"]
          id: string
          last_error: string | null
          payload: Json
          purchase_request_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          work_package_id: string | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          event_type: Database["public"]["Enums"]["notification_event_type"]
          id?: string
          last_error?: string | null
          payload?: Json
          purchase_request_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          work_package_id?: string | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["notification_event_type"]
          id?: string
          last_error?: string | null
          payload?: Json
          purchase_request_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          work_package_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      nova_dials: {
        Row: {
          dial_key: string
          updated_at: string
          updated_by: string | null
          value: number
        }
        Insert: {
          dial_key: string
          updated_at?: string
          updated_by?: string | null
          value: number
        }
        Update: {
          dial_key?: string
          updated_at?: string
          updated_by?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "nova_dials_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      peak_sync_links: {
        Row: {
          created_at: string
          id: string
          peak_doc_id: string
          peak_doc_type: Database["public"]["Enums"]["peak_doc_type"]
          source_id: string
          source_table: string
        }
        Insert: {
          created_at?: string
          id?: string
          peak_doc_id: string
          peak_doc_type: Database["public"]["Enums"]["peak_doc_type"]
          source_id: string
          source_table: string
        }
        Update: {
          created_at?: string
          id?: string
          peak_doc_id?: string
          peak_doc_type?: Database["public"]["Enums"]["peak_doc_type"]
          source_id?: string
          source_table?: string
        }
        Relationships: []
      }
      peak_sync_outbox: {
        Row: {
          attempts: number
          created_at: string
          entity_type: Database["public"]["Enums"]["peak_entity_type"]
          id: string
          last_error: string | null
          operation: Database["public"]["Enums"]["peak_sync_operation"]
          payload: Json
          peak_doc_id: string | null
          peak_doc_type: Database["public"]["Enums"]["peak_doc_type"] | null
          sent_at: string | null
          source_id: string
          source_table: string
          status: Database["public"]["Enums"]["peak_sync_status"]
        }
        Insert: {
          attempts?: number
          created_at?: string
          entity_type: Database["public"]["Enums"]["peak_entity_type"]
          id?: string
          last_error?: string | null
          operation?: Database["public"]["Enums"]["peak_sync_operation"]
          payload?: Json
          peak_doc_id?: string | null
          peak_doc_type?: Database["public"]["Enums"]["peak_doc_type"] | null
          sent_at?: string | null
          source_id: string
          source_table: string
          status?: Database["public"]["Enums"]["peak_sync_status"]
        }
        Update: {
          attempts?: number
          created_at?: string
          entity_type?: Database["public"]["Enums"]["peak_entity_type"]
          id?: string
          last_error?: string | null
          operation?: Database["public"]["Enums"]["peak_sync_operation"]
          payload?: Json
          peak_doc_id?: string | null
          peak_doc_type?: Database["public"]["Enums"]["peak_doc_type"] | null
          sent_at?: string | null
          source_id?: string
          source_table?: string
          status?: Database["public"]["Enums"]["peak_sync_status"]
        }
        Relationships: []
      }
      photo_logs: {
        Row: {
          captured_at_client: string | null
          created_at: string
          id: string
          phase: Database["public"]["Enums"]["photo_phase"]
          storage_path: string | null
          superseded_by: string | null
          uploaded_by: string
          work_package_id: string
        }
        Insert: {
          captured_at_client?: string | null
          created_at?: string
          id?: string
          phase: Database["public"]["Enums"]["photo_phase"]
          storage_path?: string | null
          superseded_by?: string | null
          uploaded_by: string
          work_package_id: string
        }
        Update: {
          captured_at_client?: string | null
          created_at?: string
          id?: string
          phase?: Database["public"]["Enums"]["photo_phase"]
          storage_path?: string | null
          superseded_by?: string | null
          uploaded_by?: string
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_logs_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "photo_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_logs_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_logs_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_markups: {
        Row: {
          comment: string | null
          created_at: string
          created_by: string
          id: string
          photo_log_id: string
          strokes: Json | null
          superseded_by: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          created_by: string
          id?: string
          photo_log_id: string
          strokes?: Json | null
          superseded_by?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          created_by?: string
          id?: string
          photo_log_id?: string
          strokes?: Json | null
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "photo_markups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_markups_photo_log_id_fkey"
            columns: ["photo_log_id"]
            isOneToOne: false
            referencedRelation: "photo_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_markups_supersede_fk"
            columns: ["superseded_by", "photo_log_id"]
            isOneToOne: false
            referencedRelation: "photo_markups"
            referencedColumns: ["id", "photo_log_id"]
          },
          {
            foreignKeyName: "photo_markups_supersede_fk"
            columns: ["superseded_by", "photo_log_id"]
            isOneToOne: false
            referencedRelation: "photo_markups_current"
            referencedColumns: ["id", "photo_log_id"]
          },
        ]
      }
      project_coin_distributions: {
        Row: {
          coin_pool: number
          dc_count: number
          dc_distributed: number
          distributed_at: string
          distributed_by: string
          ht_coins: number
          ht_worker_id: string | null
          project_id: string
        }
        Insert: {
          coin_pool: number
          dc_count: number
          dc_distributed: number
          distributed_at?: string
          distributed_by: string
          ht_coins: number
          ht_worker_id?: string | null
          project_id: string
        }
        Update: {
          coin_pool?: number
          dc_count?: number
          dc_distributed?: number
          distributed_at?: string
          distributed_by?: string
          ht_coins?: number
          ht_worker_id?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_coin_distributions_distributed_by_fkey"
            columns: ["distributed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_coin_distributions_ht_worker_id_fkey"
            columns: ["ht_worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_coin_distributions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          added_at: string
          added_by: string
          project_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          project_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_settlements: {
        Row: {
          banked_profit_total: number
          coin_multiplier: number
          coin_pool: number
          equipment_costed: boolean
          project_id: string
          settled_at: string
          settled_by: string
          wp_banked_count: number
          wp_skipped_null_budget_count: number
        }
        Insert: {
          banked_profit_total: number
          coin_multiplier: number
          coin_pool: number
          equipment_costed: boolean
          project_id: string
          settled_at?: string
          settled_by: string
          wp_banked_count: number
          wp_skipped_null_budget_count: number
        }
        Update: {
          banked_profit_total?: number
          coin_multiplier?: number
          coin_pool?: number
          equipment_costed?: boolean
          project_id?: string
          settled_at?: string
          settled_by?: string
          wp_banked_count?: number
          wp_skipped_null_budget_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_settlements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_settlements_settled_by_fkey"
            columns: ["settled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget_amount_thb: number | null
          client_id: string | null
          code: string
          contract_reference: string | null
          created_at: string
          ht_worker_id: string | null
          id: string
          name: string
          notes: string | null
          onboarding_dismissed_at: string | null
          planned_completion_date: string | null
          project_lead_id: string | null
          project_type: Database["public"]["Enums"]["project_type"] | null
          site_address: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          budget_amount_thb?: number | null
          client_id?: string | null
          code: string
          contract_reference?: string | null
          created_at?: string
          ht_worker_id?: string | null
          id?: string
          name: string
          notes?: string | null
          onboarding_dismissed_at?: string | null
          planned_completion_date?: string | null
          project_lead_id?: string | null
          project_type?: Database["public"]["Enums"]["project_type"] | null
          site_address?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          budget_amount_thb?: number | null
          client_id?: string | null
          code?: string
          contract_reference?: string | null
          created_at?: string
          ht_worker_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          onboarding_dismissed_at?: string | null
          planned_completion_date?: string | null
          project_lead_id?: string | null
          project_type?: Database["public"]["Enums"]["project_type"] | null
          site_address?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_ht_worker_id_fkey"
            columns: ["ht_worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_project_lead_id_fkey"
            columns: ["project_lead_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_attachments: {
        Row: {
          created_at: string
          created_by: string
          delivery_id: string | null
          id: string
          kind: Database["public"]["Enums"]["purchase_order_attachment_kind"]
          purchase_order_id: string
          purpose: Database["public"]["Enums"]["purchase_order_attachment_purpose"]
          storage_path: string | null
          superseded_by: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          delivery_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["purchase_order_attachment_kind"]
          purchase_order_id: string
          purpose?: Database["public"]["Enums"]["purchase_order_attachment_purpose"]
          storage_path?: string | null
          superseded_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          delivery_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["purchase_order_attachment_kind"]
          purchase_order_id?: string
          purpose?: Database["public"]["Enums"]["purchase_order_attachment_purpose"]
          storage_path?: string | null
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "poa_supersede_fk"
            columns: ["superseded_by", "purchase_order_id", "kind"]
            isOneToOne: false
            referencedRelation: "purchase_order_attachments"
            referencedColumns: ["id", "purchase_order_id", "kind"]
          },
          {
            foreignKeyName: "poa_supersede_fk"
            columns: ["superseded_by", "purchase_order_id", "kind"]
            isOneToOne: false
            referencedRelation: "purchase_order_attachments_current"
            referencedColumns: ["id", "purchase_order_id", "kind"]
          },
          {
            foreignKeyName: "purchase_order_attachments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_attachments_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_attachments_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_deliveries: {
        Row: {
          carrier: string | null
          cost: number | null
          created_at: string
          created_by: string
          eta: string | null
          id: string
          note: string | null
          purchase_order_id: string
          updated_at: string
        }
        Insert: {
          carrier?: string | null
          cost?: number | null
          created_at?: string
          created_by: string
          eta?: string | null
          id?: string
          note?: string | null
          purchase_order_id: string
          updated_at?: string
        }
        Update: {
          carrier?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string
          eta?: string | null
          id?: string
          note?: string | null
          purchase_order_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_deliveries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_deliveries_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by: string
          eta: string | null
          id: string
          notes: string | null
          ordered_at: string | null
          po_number: number
          supplier: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          eta?: string | null
          id?: string
          notes?: string | null
          ordered_at?: string | null
          po_number?: number
          supplier: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          eta?: string | null
          id?: string
          notes?: string | null
          ordered_at?: string | null
          po_number?: number
          supplier?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_request_attachment_tokens: {
        Row: {
          access_token: string
          attachment_id: string
          rotated_at: string | null
        }
        Insert: {
          access_token?: string
          attachment_id: string
          rotated_at?: string | null
        }
        Update: {
          access_token?: string
          attachment_id?: string
          rotated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_request_attachment_tokens_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: true
            referencedRelation: "purchase_request_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_attachment_tokens_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: true
            referencedRelation: "purchase_request_attachments_appsheet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_attachment_tokens_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: true
            referencedRelation: "purchase_request_attachments_current"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_request_attachments: {
        Row: {
          created_at: string
          created_by: string
          id: string
          kind: Database["public"]["Enums"]["purchase_request_attachment_kind"]
          purchase_request_id: string
          purpose: Database["public"]["Enums"]["purchase_request_attachment_purpose"]
          storage_path: string | null
          superseded_by: string | null
          url: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          kind: Database["public"]["Enums"]["purchase_request_attachment_kind"]
          purchase_request_id: string
          purpose?: Database["public"]["Enums"]["purchase_request_attachment_purpose"]
          storage_path?: string | null
          superseded_by?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          kind?: Database["public"]["Enums"]["purchase_request_attachment_kind"]
          purchase_request_id?: string
          purpose?: Database["public"]["Enums"]["purchase_request_attachment_purpose"]
          storage_path?: string | null
          superseded_by?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pra_supersede_fk"
            columns: ["superseded_by", "purchase_request_id", "kind"]
            isOneToOne: false
            referencedRelation: "purchase_request_attachments"
            referencedColumns: ["id", "purchase_request_id", "kind"]
          },
          {
            foreignKeyName: "pra_supersede_fk"
            columns: ["superseded_by", "purchase_request_id", "kind"]
            isOneToOne: false
            referencedRelation: "purchase_request_attachments_appsheet"
            referencedColumns: ["id", "purchase_request_id", "kind"]
          },
          {
            foreignKeyName: "pra_supersede_fk"
            columns: ["superseded_by", "purchase_request_id", "kind"]
            isOneToOne: false
            referencedRelation: "purchase_request_attachments_current"
            referencedColumns: ["id", "purchase_request_id", "kind"]
          },
          {
            foreignKeyName: "purchase_request_attachments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_attachments_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_requests: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          amount: number | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          decided_at: string | null
          decision_comment: string | null
          delivered_at: string | null
          delivery_batch_id: string | null
          delivery_id: string | null
          delivery_note: string | null
          eta: string | null
          id: string
          item_description: string
          needed_by: string | null
          notes: string | null
          order_ref: string | null
          pr_number: number
          priority: Database["public"]["Enums"]["purchase_request_priority"]
          purchase_order_id: string | null
          purchased_at: string | null
          quantity: number
          received_by: string | null
          received_by_id: string | null
          requested_at: string
          requested_by: string | null
          requested_by_email: string | null
          shipped_at: string | null
          source: string
          split_from_request_id: string | null
          status: Database["public"]["Enums"]["purchase_request_status"]
          supplier: string | null
          supplier_id: string | null
          unit: string
          updated_at: string
          vat_rate: number
          work_package_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          amount?: number | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          decided_at?: string | null
          decision_comment?: string | null
          delivered_at?: string | null
          delivery_batch_id?: string | null
          delivery_id?: string | null
          delivery_note?: string | null
          eta?: string | null
          id?: string
          item_description: string
          needed_by?: string | null
          notes?: string | null
          order_ref?: string | null
          pr_number?: number
          priority?: Database["public"]["Enums"]["purchase_request_priority"]
          purchase_order_id?: string | null
          purchased_at?: string | null
          quantity: number
          received_by?: string | null
          received_by_id?: string | null
          requested_at?: string
          requested_by?: string | null
          requested_by_email?: string | null
          shipped_at?: string | null
          source?: string
          split_from_request_id?: string | null
          status?: Database["public"]["Enums"]["purchase_request_status"]
          supplier?: string | null
          supplier_id?: string | null
          unit: string
          updated_at?: string
          vat_rate?: number
          work_package_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          amount?: number | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          decided_at?: string | null
          decision_comment?: string | null
          delivered_at?: string | null
          delivery_batch_id?: string | null
          delivery_id?: string | null
          delivery_note?: string | null
          eta?: string | null
          id?: string
          item_description?: string
          needed_by?: string | null
          notes?: string | null
          order_ref?: string | null
          pr_number?: number
          priority?: Database["public"]["Enums"]["purchase_request_priority"]
          purchase_order_id?: string | null
          purchased_at?: string | null
          quantity?: number
          received_by?: string | null
          received_by_id?: string | null
          requested_at?: string
          requested_by?: string | null
          requested_by_email?: string | null
          shipped_at?: string | null
          source?: string
          split_from_request_id?: string | null
          status?: Database["public"]["Enums"]["purchase_request_status"]
          supplier?: string | null
          supplier_id?: string | null
          unit?: string
          updated_at?: string
          vat_rate?: number
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_requests_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_received_by_id_fkey"
            columns: ["received_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_split_from_request_id_fkey"
            columns: ["split_from_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          error: string | null
          id: string
          params: Json
          project_id: string
          requested_by: string
          status: Database["public"]["Enums"]["report_status"]
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          params?: Json
          project_id: string
          requested_by: string
          status?: Database["public"]["Enums"]["report_status"]
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          params?: Json
          project_id?: string
          requested_by?: string
          status?: Database["public"]["Enums"]["report_status"]
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_receivables: {
        Row: {
          amount_withheld: number
          client_billing_id: string
          created_at: string
          due_date: string | null
          id: string
          project_id: string
          release_entry_id: string | null
          released_at: string | null
          released_by: string | null
          status: Database["public"]["Enums"]["retention_status"]
        }
        Insert: {
          amount_withheld: number
          client_billing_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          project_id: string
          release_entry_id?: string | null
          released_at?: string | null
          released_by?: string | null
          status?: Database["public"]["Enums"]["retention_status"]
        }
        Update: {
          amount_withheld?: number
          client_billing_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          project_id?: string
          release_entry_id?: string | null
          released_at?: string | null
          released_by?: string | null
          status?: Database["public"]["Enums"]["retention_status"]
        }
        Relationships: [
          {
            foreignKeyName: "retention_receivables_client_billing_id_fkey"
            columns: ["client_billing_id"]
            isOneToOne: true
            referencedRelation: "client_billings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_receivables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_receivables_release_entry_id_fkey"
            columns: ["release_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_receivables_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sell_rate_table: {
        Row: {
          cost_band: number
          external_sell: number
          internal_sell: number
          level: Database["public"]["Enums"]["worker_level"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cost_band: number
          external_sell: number
          internal_sell: number
          level: Database["public"]["Enums"]["worker_level"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cost_band?: number
          external_sell?: number
          internal_sell?: number
          level?: Database["public"]["Enums"]["worker_level"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sell_rate_table_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      service_providers: {
        Row: {
          contact_person: string | null
          created_at: string
          created_by: string
          email: string | null
          id: string
          mailing_address: string | null
          name: string
          note: string | null
          phone: string | null
          plate_no: string | null
          service_subtype: Database["public"]["Enums"]["service_subtype"]
          status: Database["public"]["Enums"]["contact_status"]
          vehicle_type: string | null
        }
        Insert: {
          contact_person?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          mailing_address?: string | null
          name: string
          note?: string | null
          phone?: string | null
          plate_no?: string | null
          service_subtype?: Database["public"]["Enums"]["service_subtype"]
          status?: Database["public"]["Enums"]["contact_status"]
          vehicle_type?: string | null
        }
        Update: {
          contact_person?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          mailing_address?: string | null
          name?: string
          note?: string | null
          phone?: string | null
          plate_no?: string | null
          service_subtype?: Database["public"]["Enums"]["service_subtype"]
          status?: Database["public"]["Enums"]["contact_status"]
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_providers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_items: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          price_coins: number
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
          price_coins: number
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          price_coins?: number
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_redemptions: {
        Row: {
          id: string
          item_id: string
          posting_id: string
          price_coins: number
          redeemed_at: string
          redeemed_by: string
          worker_id: string
        }
        Insert: {
          id?: string
          item_id: string
          posting_id: string
          price_coins: number
          redeemed_at?: string
          redeemed_by: string
          worker_id: string
        }
        Update: {
          id?: string
          item_id?: string
          posting_id?: string
          price_coins?: number
          redeemed_at?: string
          redeemed_by?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_redemptions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "shop_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_redemptions_posting_id_fkey"
            columns: ["posting_id"]
            isOneToOne: false
            referencedRelation: "coin_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_redemptions_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_redemptions_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact_person: string | null
          created_at: string
          created_by: string
          email: string | null
          id: string
          mailing_address: string | null
          name: string
          note: string | null
          payment_terms: string | null
          phone: string | null
          tax_id: string | null
        }
        Insert: {
          contact_person?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          mailing_address?: string | null
          name: string
          note?: string | null
          payment_terms?: string | null
          phone?: string | null
          tax_id?: string | null
        }
        Update: {
          contact_person?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          mailing_address?: string | null
          name?: string
          note?: string | null
          payment_terms?: string | null
          phone?: string | null
          tax_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          line_avatar_url: string | null
          line_user_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          line_avatar_url?: string | null
          line_user_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          line_avatar_url?: string | null
          line_user_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      wht_certificates: {
        Row: {
          base_amount: number
          cert_no: number
          client_id: string | null
          contractor_id: string | null
          created_at: string
          created_by: string
          direction: Database["public"]["Enums"]["wht_direction"]
          id: string
          income_type: string
          issued_date: string
          note: string | null
          pay_source_id: string | null
          pay_source_table: string | null
          supplier_id: string | null
          tax_form: Database["public"]["Enums"]["wht_form"]
          tax_id_13: string
          wht_amount: number
          wht_rate: number
        }
        Insert: {
          base_amount: number
          cert_no?: number
          client_id?: string | null
          contractor_id?: string | null
          created_at?: string
          created_by: string
          direction: Database["public"]["Enums"]["wht_direction"]
          id?: string
          income_type: string
          issued_date?: string
          note?: string | null
          pay_source_id?: string | null
          pay_source_table?: string | null
          supplier_id?: string | null
          tax_form: Database["public"]["Enums"]["wht_form"]
          tax_id_13: string
          wht_amount: number
          wht_rate: number
        }
        Update: {
          base_amount?: number
          cert_no?: number
          client_id?: string | null
          contractor_id?: string | null
          created_at?: string
          created_by?: string
          direction?: Database["public"]["Enums"]["wht_direction"]
          id?: string
          income_type?: string
          issued_date?: string
          note?: string | null
          pay_source_id?: string | null
          pay_source_table?: string | null
          supplier_id?: string | null
          tax_form?: Database["public"]["Enums"]["wht_form"]
          tax_id_13?: string
          wht_amount?: number
          wht_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "wht_certificates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wht_certificates_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wht_certificates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wht_certificates_income_type_fkey"
            columns: ["income_type"]
            isOneToOne: false
            referencedRelation: "wht_rates"
            referencedColumns: ["income_type"]
          },
          {
            foreignKeyName: "wht_certificates_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      wht_rates: {
        Row: {
          default_rate: number
          income_type: string
          label_th: string
        }
        Insert: {
          default_rate: number
          income_type: string
          label_th: string
        }
        Update: {
          default_rate?: number
          income_type?: string
          label_th?: string
        }
        Relationships: []
      }
      work_package_dependencies: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          predecessor_id: string
          successor_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          predecessor_id: string
          successor_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          predecessor_id?: string
          successor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_package_dependencies_predecessor_id_fkey"
            columns: ["predecessor_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_package_dependencies_successor_id_fkey"
            columns: ["successor_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      work_package_members: {
        Row: {
          added_at: string
          added_by: string
          user_id: string
          work_package_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          user_id: string
          work_package_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          user_id?: string
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_package_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_package_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_package_members_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      work_packages: {
        Row: {
          code: string
          contractor_id: string | null
          created_at: string
          deliverable_id: string | null
          description: string | null
          id: string
          name: string
          notes: string | null
          owner_id: string | null
          planned_end: string | null
          planned_start: string | null
          priority: Database["public"]["Enums"]["work_package_priority"]
          project_id: string
          status: Database["public"]["Enums"]["work_package_status"]
          updated_at: string
        }
        Insert: {
          code: string
          contractor_id?: string | null
          created_at?: string
          deliverable_id?: string | null
          description?: string | null
          id?: string
          name: string
          notes?: string | null
          owner_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          priority?: Database["public"]["Enums"]["work_package_priority"]
          project_id: string
          status?: Database["public"]["Enums"]["work_package_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          contractor_id?: string | null
          created_at?: string
          deliverable_id?: string | null
          description?: string | null
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          priority?: Database["public"]["Enums"]["work_package_priority"]
          project_id?: string
          status?: Database["public"]["Enums"]["work_package_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_packages_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_packages_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_packages_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_packages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_project_moves: {
        Row: {
          id: string
          moved_at: string
          moved_by: string
          project_id: string | null
          reason: string | null
          worker_id: string
        }
        Insert: {
          id?: string
          moved_at?: string
          moved_by: string
          project_id?: string | null
          reason?: string | null
          worker_id: string
        }
        Update: {
          id?: string
          moved_at?: string
          moved_by?: string
          project_id?: string | null
          reason?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_project_moves_moved_by_fkey"
            columns: ["moved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_project_moves_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_project_moves_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      workers: {
        Row: {
          active: boolean
          contractor_id: string | null
          created_at: string
          created_by: string
          day_rate: number
          id: string
          level: Database["public"]["Enums"]["worker_level"] | null
          name: string
          note: string | null
          project_id: string | null
          user_id: string | null
          worker_type: Database["public"]["Enums"]["worker_type"]
        }
        Insert: {
          active?: boolean
          contractor_id?: string | null
          created_at?: string
          created_by: string
          day_rate?: number
          id?: string
          level?: Database["public"]["Enums"]["worker_level"] | null
          name: string
          note?: string | null
          project_id?: string | null
          user_id?: string | null
          worker_type: Database["public"]["Enums"]["worker_type"]
        }
        Update: {
          active?: boolean
          contractor_id?: string | null
          created_at?: string
          created_by?: string
          day_rate?: number
          id?: string
          level?: Database["public"]["Enums"]["worker_level"] | null
          name?: string
          note?: string | null
          project_id?: string | null
          user_id?: string | null
          worker_type?: Database["public"]["Enums"]["worker_type"]
        }
        Relationships: [
          {
            foreignKeyName: "workers_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      wp_economics: {
        Row: {
          budget: number | null
          is_external: boolean
          updated_at: string
          updated_by: string | null
          work_package_id: string
        }
        Insert: {
          budget?: number | null
          is_external?: boolean
          updated_at?: string
          updated_by?: string | null
          work_package_id: string
        }
        Update: {
          budget?: number | null
          is_external?: boolean
          updated_at?: string
          updated_by?: string | null
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wp_economics_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wp_economics_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: true
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      wp_labor_costs: {
        Row: {
          computed_at: string
          dc_cost: number
          frozen_by: string
          own_cost: number
          work_package_id: string
        }
        Insert: {
          computed_at?: string
          dc_cost: number
          frozen_by: string
          own_cost: number
          work_package_id: string
        }
        Update: {
          computed_at?: string
          dc_cost?: number
          frozen_by?: string
          own_cost?: number
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wp_labor_costs_frozen_by_fkey"
            columns: ["frozen_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wp_labor_costs_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: true
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      wp_profit_bank: {
        Row: {
          banked_at: string
          budget: number | null
          equipment_cost: number
          equipment_costed: boolean
          id: string
          labor_sell: number
          materials_cost: number
          profit: number
          project_id: string
          work_package_id: string
        }
        Insert: {
          banked_at?: string
          budget?: number | null
          equipment_cost: number
          equipment_costed: boolean
          id?: string
          labor_sell: number
          materials_cost: number
          profit: number
          project_id: string
          work_package_id: string
        }
        Update: {
          banked_at?: string
          budget?: number | null
          equipment_cost?: number
          equipment_costed?: boolean
          id?: string
          labor_sell?: number
          materials_cost?: number
          profit?: number
          project_id?: string
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wp_profit_bank_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wp_profit_bank_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      wp_templates: {
        Row: {
          code: string
          description: string | null
          id: string
          name: string
          project_type: Database["public"]["Enums"]["project_type"]
          sort_order: number
        }
        Insert: {
          code: string
          description?: string | null
          id?: string
          name: string
          project_type: Database["public"]["Enums"]["project_type"]
          sort_order?: number
        }
        Update: {
          code?: string
          description?: string | null
          id?: string
          name?: string
          project_type?: Database["public"]["Enums"]["project_type"]
          sort_order?: number
        }
        Relationships: []
      }
    }
    Views: {
      photo_markups_current: {
        Row: {
          comment: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          photo_log_id: string | null
          strokes: Json | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          photo_log_id?: string | null
          strokes?: Json | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          photo_log_id?: string | null
          strokes?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "photo_markups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_markups_photo_log_id_fkey"
            columns: ["photo_log_id"]
            isOneToOne: false
            referencedRelation: "photo_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_attachments_current: {
        Row: {
          created_at: string | null
          created_by: string | null
          delivery_id: string | null
          id: string | null
          kind:
            | Database["public"]["Enums"]["purchase_order_attachment_kind"]
            | null
          purchase_order_id: string | null
          purpose:
            | Database["public"]["Enums"]["purchase_order_attachment_purpose"]
            | null
          storage_path: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          delivery_id?: string | null
          id?: string | null
          kind?:
            | Database["public"]["Enums"]["purchase_order_attachment_kind"]
            | null
          purchase_order_id?: string | null
          purpose?:
            | Database["public"]["Enums"]["purchase_order_attachment_purpose"]
            | null
          storage_path?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          delivery_id?: string | null
          id?: string | null
          kind?:
            | Database["public"]["Enums"]["purchase_order_attachment_kind"]
            | null
          purchase_order_id?: string | null
          purpose?:
            | Database["public"]["Enums"]["purchase_order_attachment_purpose"]
            | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_attachments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_attachments_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_attachments_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_request_attachments_appsheet: {
        Row: {
          access_token: string | null
          created_at: string | null
          id: string | null
          kind:
            | Database["public"]["Enums"]["purchase_request_attachment_kind"]
            | null
          purchase_request_id: string | null
          purpose:
            | Database["public"]["Enums"]["purchase_request_attachment_purpose"]
            | null
          storage_path: string | null
          url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_request_attachments_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_request_attachments_current: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string | null
          kind:
            | Database["public"]["Enums"]["purchase_request_attachment_kind"]
            | null
          purchase_request_id: string | null
          purpose:
            | Database["public"]["Enums"]["purchase_request_attachment_purpose"]
            | null
          storage_path: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          kind?:
            | Database["public"]["Enums"]["purchase_request_attachment_kind"]
            | null
          purchase_request_id?: string | null
          purpose?:
            | Database["public"]["Enums"]["purchase_request_attachment_purpose"]
            | null
          storage_path?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          kind?:
            | Database["public"]["Enums"]["purchase_request_attachment_kind"]
            | null
          purchase_request_id?: string | null
          purpose?:
            | Database["public"]["Enums"]["purchase_request_attachment_purpose"]
            | null
          storage_path?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_request_attachments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_attachments_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acknowledge_site_purchase: { Args: { p_id: string }; Returns: undefined }
      add_contact_document: {
        Args: {
          p_contractor_id?: string
          p_purpose?: Database["public"]["Enums"]["contact_doc_purpose"]
          p_service_provider_id?: string
          p_storage_path?: string
          p_supplier_id?: string
        }
        Returns: string
      }
      add_work_package_dependency: {
        Args: { p_predecessor: string; p_successor: string }
        Returns: boolean
      }
      apply_wp_template: { Args: { p_project_id: string }; Returns: number }
      assign_project_ht: {
        Args: { p_project: string; p_worker: string }
        Returns: undefined
      }
      assign_worker_to_project: {
        Args: { p_project?: string; p_reason?: string; p_worker: string }
        Returns: undefined
      }
      award_savers_bonus: { Args: { p_worker: string }; Returns: number }
      can_see_photo_log: { Args: { p_photo_log_id: string }; Returns: boolean }
      can_see_project: { Args: { p_project_id: string }; Returns: boolean }
      can_see_wp: { Args: { p_work_package_id: string }; Returns: boolean }
      certify_client_billing: { Args: { p_id: string }; Returns: string }
      check_in_equipment: {
        Args: { p_date: string; p_log: string }
        Returns: string
      }
      check_out_equipment: {
        Args: { p_date: string; p_item: string; p_wp: string }
        Returns: string
      }
      claim_contractor_invite: { Args: { p_token: string }; Returns: string }
      claim_next_report: {
        Args: never
        Returns: {
          created_at: string
          error: string | null
          id: string
          params: Json
          project_id: string
          requested_by: string
          status: Database["public"]["Enums"]["report_status"]
          storage_path: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "reports"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claw_back_project_coins: {
        Args: { p_note?: string; p_project: string }
        Returns: {
          clawed_total: number
          clawed_workers: number
        }[]
      }
      clone_work_packages: {
        Args: { p_dst_project_id: string; p_src_project_id: string }
        Returns: number
      }
      coin_balance: { Args: { p_worker: string }; Returns: number }
      coin_spendable_balance: { Args: { p_worker: string }; Returns: number }
      coin_unvested_balance: { Args: { p_worker: string }; Returns: number }
      coin_vested_balance: { Args: { p_worker: string }; Returns: number }
      confiscate_coins: {
        Args: {
          p_note?: string
          p_reason: Database["public"]["Enums"]["confiscation_reason"]
          p_worker: string
        }
        Returns: number
      }
      correct_labor_log: {
        Args: {
          p_fraction?: Database["public"]["Enums"]["day_fraction"]
          p_log: string
          p_note?: string
          p_reason: string
          p_tombstone?: boolean
        }
        Returns: string
      }
      create_client_billing: {
        Args: {
          p_gross_amount: number
          p_note?: string
          p_period_from?: string
          p_period_to?: string
          p_project_id: string
          p_retention_rate?: number
          p_vat_rate?: number
          p_wht_rate?: number
        }
        Returns: string
      }
      create_contractor_invite: {
        Args: { p_contractor_id: string }
        Returns: string
      }
      create_deliverable: {
        Args: { p_code: string; p_name: string; p_project_id: string }
        Returns: string
      }
      create_equipment_project_allocation: {
        Args: {
          p_batch_id: string
          p_ends_on?: string
          p_note?: string
          p_project_id: string
          p_starts_on: string
        }
        Returns: string
      }
      create_equipment_rental_batch: {
        Args: {
          p_ends_on?: string
          p_monthly_rate: number
          p_note?: string
          p_owner_id: string
          p_starts_on: string
        }
        Returns: string
      }
      create_project: {
        Args: {
          p_client_id?: string
          p_code: string
          p_name: string
          p_project_type?: Database["public"]["Enums"]["project_type"]
        }
        Returns: string
      }
      create_purchase_order: {
        Args: {
          p_eta: string
          p_lines: Json
          p_order_ref?: string
          p_supplier_id: string
          p_vat_rate?: number
        }
        Returns: string
      }
      create_work_package: {
        Args: {
          p_code: string
          p_description?: string
          p_name: string
          p_project_id: string
        }
        Returns: string
      }
      create_worker: {
        Args: {
          p_contractor?: string
          p_day_rate: number
          p_name: string
          p_note?: string
          p_type: Database["public"]["Enums"]["worker_type"]
          p_user?: string
        }
        Returns: string
      }
      current_user_contractor_id: { Args: never; Returns: string }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      decide_contractor_bank_change: {
        Args: { p_approve: boolean; p_id: string }
        Returns: undefined
      }
      delete_deliverable: {
        Args: { p_deliverable_id: string }
        Returns: boolean
      }
      delete_work_package: {
        Args: { p_work_package_id: string }
        Returns: boolean
      }
      dismiss_project_onboarding: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      dispatch_purchase_order_delivery: {
        Args: { p_delivery_id: string }
        Returns: number
      }
      distribute_project_coins: {
        Args: { p_project: string }
        Returns: {
          dc_count: number
          dc_distributed: number
          ht_coins: number
          total_distributed: number
        }[]
      }
      drain_gl_posting: { Args: { p_limit?: number }; Returns: number }
      enqueue_gl_posting: {
        Args: {
          p_source_event: string
          p_source_id: string
          p_source_table: string
        }
        Returns: string
      }
      enqueue_peak_sync: {
        Args: {
          p_entity_type: Database["public"]["Enums"]["peak_entity_type"]
          p_operation?: Database["public"]["Enums"]["peak_sync_operation"]
          p_payload?: Json
          p_source_id: string
          p_source_table: string
        }
        Returns: string
      }
      freeze_wp_labor_cost: { Args: { p_wp: string }; Returns: undefined }
      get_my_crew_assignments: {
        Args: never
        Returns: {
          active: boolean
          name: string
          project_code: string
          project_id: string
          project_name: string
          worker_id: string
        }[]
      }
      get_my_dc_payments: {
        Args: never
        Returns: {
          computed_amount: number
          computed_days: number
          contractor_id: string
          correction_reason: string | null
          created_at: string
          id: string
          method: Database["public"]["Enums"]["dc_payment_method"]
          note: string | null
          paid_amount: number | null
          paid_at: string
          paid_by: string
          period_from: string
          period_to: string
          reference: string | null
          superseded_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "dc_payments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      gl_reconciliation: {
        Args: never
        Returns: {
          check_name: string
          drift: number
          gl_value: number
          ok: boolean
          subledger_value: number
        }[]
      }
      gl_trial_balance: {
        Args: {
          p_from: string
          p_project_id?: string
          p_to: string
          p_work_package_id?: string
        }
        Returns: {
          account_type: Database["public"]["Enums"]["gl_account_type"]
          balance: number
          code: string
          credit_total: number
          debit_total: number
          name_th: string
        }[]
      }
      invoke_notification_drain: { Args: never; Returns: undefined }
      log_labor_day: {
        Args: {
          p_date: string
          p_fraction: Database["public"]["Enums"]["day_fraction"]
          p_note?: string
          p_worker: string
          p_wp: string
        }
        Returns: string
      }
      mark_retention_due: {
        Args: { p_due_date: string; p_id: string }
        Returns: string
      }
      my_contact_bank_present: { Args: never; Returns: boolean }
      open_accounting_period: { Args: { p_month: string }; Returns: string }
      photo_markup_tombstone_target_ok: {
        Args: { p_photo_log_id: string; p_superseded_by: string }
        Returns: boolean
      }
      post_client_billing_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_coins: {
        Args: {
          p_amount: number
          p_occurred_at?: string
          p_reason: string
          p_source: Database["public"]["Enums"]["coin_source"]
          p_source_project?: string
          p_worker: string
        }
        Returns: string
      }
      post_dc_payment_to_gl: { Args: { p_source_id: string }; Returns: string }
      post_journal_entry: {
        Args: { p_entry_date: string; p_lines: Json; p_memo: string }
        Returns: string
      }
      post_journal_internal: {
        Args: {
          p_entry_date: string
          p_lines: Json
          p_memo: string
          p_posted_by?: string
          p_reversal_of?: string
          p_source_event: string
          p_source_id: string
          p_source_table: string
        }
        Returns: string
      }
      post_labor_freeze_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_purchase_to_gl: { Args: { p_source_id: string }; Returns: string }
      post_rental_batch_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_retention_release_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_wht_certificate_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      pr_attachment_tombstone_target_ok: {
        Args: { p_caller: string; p_parent: string; p_target: string }
        Returns: boolean
      }
      project_is_open: { Args: { p_project_id: string }; Returns: boolean }
      project_onboarding_status: {
        Args: { p_project_id: string }
        Returns: {
          budget_set: boolean
          client_set: boolean
          dates_lead_set: boolean
          dismissed: boolean
          team_added: boolean
          work_packages_added: boolean
        }[]
      }
      prune_notification_outbox: {
        Args: { p_max_age_days?: number }
        Returns: number
      }
      reap_stale_reports: {
        Args: { p_max_age_minutes?: number }
        Returns: number
      }
      receive_po_lines: {
        Args: {
          p_delivery_note?: string
          p_received_by?: string
          p_request_ids: string[]
        }
        Returns: number
      }
      record_contractor_consent: {
        Args: {
          p_contractor: string
          p_document_id?: string
          p_kind: Database["public"]["Enums"]["contractor_consent_kind"]
        }
        Returns: string
      }
      record_dc_payment: {
        Args: {
          p_contractor: string
          p_from: string
          p_method: Database["public"]["Enums"]["dc_payment_method"]
          p_note: string
          p_paid_amount: number
          p_paid_at: string
          p_reference: string
          p_to: string
        }
        Returns: string
      }
      record_purchase: {
        Args: {
          p_amount?: number
          p_eta?: string
          p_order_ref?: string
          p_purchase_request_id: string
          p_supplier_id: string
          p_vat_rate?: number
        }
        Returns: undefined
      }
      record_shipment: {
        Args: { p_purchase_request_id: string }
        Returns: undefined
      }
      record_site_purchase: {
        Args: {
          p_amount?: number
          p_item_description: string
          p_quantity: number
          p_unit: string
          p_vat_rate?: number
          p_work_package_id: string
        }
        Returns: string
      }
      record_wht_certificate: {
        Args: {
          p_base_amount: number
          p_client_id?: string
          p_contractor_id?: string
          p_direction: Database["public"]["Enums"]["wht_direction"]
          p_income_type: string
          p_issued_date?: string
          p_note?: string
          p_pay_source_id?: string
          p_pay_source_table?: string
          p_supplier_id?: string
          p_tax_form: Database["public"]["Enums"]["wht_form"]
          p_tax_id: string
          p_wht_rate?: number
        }
        Returns: string
      }
      redeem_shop_item: {
        Args: { p_item: string; p_worker: string }
        Returns: string
      }
      release_retention: { Args: { p_id: string }; Returns: string }
      remove_work_package_dependency: {
        Args: { p_predecessor: string; p_successor: string }
        Returns: boolean
      }
      reopen_work_package_for_defect: {
        Args: { p_reason: string; p_wp: string }
        Returns: boolean
      }
      resolve_posting_period: { Args: { p_date: string }; Returns: string }
      reverse_journal_entry: {
        Args: { p_entry_id: string; p_memo?: string }
        Returns: string
      }
      reverse_journal_internal: {
        Args: { p_entry_id: string; p_memo?: string; p_posted_by: string }
        Returns: string
      }
      revoke_contractor_consent: { Args: { p_id: string }; Returns: undefined }
      set_accounting_period_status: {
        Args: {
          p_month: string
          p_status: Database["public"]["Enums"]["accounting_period_status"]
        }
        Returns: boolean
      }
      set_contact_bank: {
        Args: {
          p_bank_account_name?: string
          p_bank_account_no?: string
          p_bank_name?: string
          p_contractor_id?: string
          p_service_provider_id?: string
          p_supplier_id?: string
        }
        Returns: string
      }
      set_deliverable_name: {
        Args: { p_deliverable_id: string; p_name: string }
        Returns: boolean
      }
      set_equipment_daily_rate: {
        Args: { p_id: string; p_rate: number }
        Returns: undefined
      }
      set_nova_dial: {
        Args: { p_key: string; p_value: number }
        Returns: undefined
      }
      set_project_client: {
        Args: { p_client_id: string; p_project_id: string }
        Returns: boolean
      }
      set_purchase_request_notes: {
        Args: { p_id: string; p_notes: string }
        Returns: boolean
      }
      set_sell_rate: {
        Args: {
          p_cost_band: number
          p_external_sell: number
          p_internal_sell: number
          p_level: Database["public"]["Enums"]["worker_level"]
        }
        Returns: undefined
      }
      set_shop_item_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_work_package_contractor: {
        Args: { p_contractor_id?: string; p_work_package_id: string }
        Returns: boolean
      }
      set_work_package_deliverable: {
        Args: { p_deliverable_id?: string; p_work_package_id: string }
        Returns: boolean
      }
      set_work_package_name: {
        Args: { p_name: string; p_work_package_id: string }
        Returns: boolean
      }
      set_work_package_notes: {
        Args: { p_notes: string; p_work_package_id: string }
        Returns: boolean
      }
      set_work_package_priority: {
        Args: {
          p_priority: Database["public"]["Enums"]["work_package_priority"]
          p_work_package_id: string
        }
        Returns: boolean
      }
      set_work_package_schedule: {
        Args: { p_end?: string; p_start?: string; p_work_package_id: string }
        Returns: boolean
      }
      set_worker_day_rate: {
        Args: { p_id: string; p_rate: number }
        Returns: undefined
      }
      set_worker_level: {
        Args: {
          p_level: Database["public"]["Enums"]["worker_level"]
          p_worker: string
        }
        Returns: undefined
      }
      set_wp_budget: {
        Args: { p_budget: number; p_wp: string }
        Returns: undefined
      }
      set_wp_external: {
        Args: { p_is_external: boolean; p_wp: string }
        Returns: undefined
      }
      settle_project: {
        Args: { p_project: string }
        Returns: {
          banked_profit_total: number
          coin_multiplier: number
          coin_pool: number
          equipment_costed: boolean
          wp_banked_count: number
          wp_skipped_null_budget_count: number
        }[]
      }
      split_purchase_order_delivery: {
        Args: {
          p_cost?: number
          p_eta?: string
          p_note?: string
          p_purchase_order_id: string
          p_request_ids: string[]
        }
        Returns: string
      }
      split_purchase_request_on_receipt: {
        Args: {
          p_delivered_amount?: number
          p_delivery_note?: string
          p_received_by?: string
          p_received_qty: number
          p_request_id: string
        }
        Returns: string
      }
      submit_contractor_bank_change: {
        Args: {
          p_bank_account_name: string
          p_bank_account_no: string
          p_bank_name: string
        }
        Returns: string
      }
      suggest_project_code: { Args: never; Returns: string }
      swap_deliverable_order: {
        Args: { p_a: string; p_b: string }
        Returns: boolean
      }
      update_my_display_name: {
        Args: { p_full_name: string }
        Returns: undefined
      }
      update_own_contractor_profile: {
        Args: {
          p_contact_person?: string
          p_email?: string
          p_mailing_address?: string
          p_phone?: string
        }
        Returns: undefined
      }
      update_own_emergency_contact: {
        Args: {
          p_dob?: string
          p_name: string
          p_phone: string
          p_relation: string
        }
        Returns: undefined
      }
      update_project_settings: {
        Args: {
          p_budget_amount_thb?: number
          p_name: string
          p_notes?: string
          p_planned_completion_date?: string
          p_project_id: string
          p_project_lead_id?: string
          p_project_type?: Database["public"]["Enums"]["project_type"]
          p_site_address?: string
          p_start_date?: string
          p_status: Database["public"]["Enums"]["project_status"]
        }
        Returns: boolean
      }
      update_worker: {
        Args: {
          p_active?: boolean
          p_contractor?: string
          p_id: string
          p_name?: string
          p_note?: string
        }
        Returns: undefined
      }
      upsert_gl_account: {
        Args: {
          p_account_type: Database["public"]["Enums"]["gl_account_type"]
          p_code: string
          p_is_postable?: boolean
          p_name_en: string
          p_name_th: string
          p_normal_side: string
          p_parent_code?: string
          p_peak_account_code?: string
          p_sort_order?: number
        }
        Returns: string
      }
      upsert_shop_item: {
        Args: {
          p_description?: string
          p_id?: string
          p_name: string
          p_price_coins: number
          p_sort_order?: number
        }
        Returns: string
      }
      wp_equipment_sell: { Args: { p_wp: string }; Returns: number }
      wp_labor_sell: { Args: { p_wp: string }; Returns: number }
      wp_profit: {
        Args: { p_wp: string }
        Returns: {
          budget: number
          equipment_cost: number
          equipment_costed: boolean
          labor_sell: number
          materials_cost: number
          profit: number
        }[]
      }
    }
    Enums: {
      accounting_period_status: "open" | "closing" | "closed" | "locked"
      approval_decision: "approved" | "rejected" | "needs_revision"
      audit_action:
        | "insert"
        | "update"
        | "delete"
        | "login"
        | "logout"
        | "role_change"
        | "photo_upload"
        | "photo_supersede"
        | "approve"
        | "reject"
        | "export"
        | "other"
        | "profile_update"
        | "purchase_request_decision"
        | "purchase_request_purchase"
        | "purchase_request_delivery"
        | "worker_change"
        | "labor_cost_freeze"
        | "purchase_order_create"
        | "dc_payment_recorded"
        | "equipment_rate_change"
        | "equipment_batch_create"
        | "equipment_allocation_create"
        | "gl_account_upsert"
        | "accounting_period_open"
        | "accounting_period_status_change"
        | "journal_posted"
        | "client_billing_create"
        | "client_billing_certify"
        | "retention_due"
        | "retention_release"
        | "wht_certificate_record"
      client_billing_status:
        | "draft"
        | "submitted"
        | "certified"
        | "invoiced"
        | "paid"
      coin_source:
        | "profit_share"
        | "savers_bonus"
        | "behavior_bonus"
        | "shop_redemption"
        | "confiscation"
      confiscation_reason:
        | "fraud"
        | "theft"
        | "gross_misconduct"
        | "defect_rework"
      contact_doc_purpose:
        | "id_card"
        | "bank_book"
        | "consent"
        | "house_registration"
        | "insurance"
        | "company_cert"
        | "vat_cert"
        | "contract"
      contact_status: "active" | "probation" | "blacklisted"
      contractor_category: "contractor" | "dc"
      contractor_change_status: "pending" | "approved" | "rejected"
      contractor_consent_kind: "pdpa_data" | "background_check"
      contractor_subtype:
        | "regular"
        | "dc_company"
        | "dc_regular"
        | "dc_temporary"
      day_fraction: "full" | "half"
      dc_payment_method: "bank_transfer" | "cash" | "cheque"
      equipment_movement_kind:
        | "received"
        | "deployed"
        | "returned"
        | "maintenance"
        | "lost"
      equipment_status:
        | "available"
        | "on_site"
        | "in_use"
        | "maintenance"
        | "returned"
        | "lost"
      equipment_tracking: "unit" | "bulk"
      gl_account_type: "asset" | "liability" | "equity" | "income" | "expense"
      gl_posting_status: "pending" | "posting" | "posted" | "failed" | "skipped"
      journal_entry_status: "draft" | "posted" | "reversed"
      login_handoff_status: "pending" | "approved" | "consumed"
      notification_event_type:
        | "wp_pending_approval"
        | "wp_decision"
        | "pr_created"
        | "pr_decision"
        | "pr_progress"
        | "pr_cancelled"
      notification_status: "pending" | "sending" | "sent" | "failed" | "expired"
      peak_doc_type: "contact" | "expense"
      peak_entity_type: "contact" | "expense"
      peak_sync_operation: "create" | "void"
      peak_sync_status: "pending" | "sending" | "sent" | "failed" | "skipped"
      photo_phase: "before" | "during" | "after"
      project_status: "active" | "on_hold" | "completed" | "archived"
      project_type:
        | "new_building"
        | "renovation"
        | "factory_warehouse"
        | "infrastructure"
        | "systems"
        | "other"
      purchase_order_attachment_kind: "image" | "pdf"
      purchase_order_attachment_purpose: "source_document" | "proof_of_delivery"
      purchase_request_attachment_kind: "image" | "link" | "pdf"
      purchase_request_attachment_purpose:
        | "reference"
        | "delivery_confirmation"
        | "invoice"
      purchase_request_priority: "normal" | "urgent" | "critical"
      purchase_request_status:
        | "requested"
        | "approved"
        | "rejected"
        | "cancelled"
        | "purchased"
        | "on_route"
        | "delivered"
        | "site_purchased"
      report_status: "requested" | "processing" | "complete" | "failed"
      retention_status: "held" | "due" | "released" | "forfeited"
      service_subtype: "transport"
      user_role:
        | "site_admin"
        | "project_manager"
        | "super_admin"
        | "project_coordinator"
        | "procurement"
        | "technician"
        | "hr"
        | "subcon_manager"
        | "accounting"
        | "visitor"
        | "contractor"
        | "project_director"
      wht_direction: "deducted" | "suffered"
      wht_form: "pnd3" | "pnd53" | "pnd1"
      work_package_priority: "normal" | "urgent" | "critical"
      work_package_status:
        | "not_started"
        | "in_progress"
        | "on_hold"
        | "complete"
        | "pending_approval"
        | "rework"
      worker_level: "senior" | "mid" | "junior" | "apprentice"
      worker_type: "own" | "dc"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      accounting_period_status: ["open", "closing", "closed", "locked"],
      approval_decision: ["approved", "rejected", "needs_revision"],
      audit_action: [
        "insert",
        "update",
        "delete",
        "login",
        "logout",
        "role_change",
        "photo_upload",
        "photo_supersede",
        "approve",
        "reject",
        "export",
        "other",
        "profile_update",
        "purchase_request_decision",
        "purchase_request_purchase",
        "purchase_request_delivery",
        "worker_change",
        "labor_cost_freeze",
        "purchase_order_create",
        "dc_payment_recorded",
        "equipment_rate_change",
        "equipment_batch_create",
        "equipment_allocation_create",
        "gl_account_upsert",
        "accounting_period_open",
        "accounting_period_status_change",
        "journal_posted",
        "client_billing_create",
        "client_billing_certify",
        "retention_due",
        "retention_release",
        "wht_certificate_record",
      ],
      client_billing_status: [
        "draft",
        "submitted",
        "certified",
        "invoiced",
        "paid",
      ],
      coin_source: [
        "profit_share",
        "savers_bonus",
        "behavior_bonus",
        "shop_redemption",
        "confiscation",
      ],
      confiscation_reason: [
        "fraud",
        "theft",
        "gross_misconduct",
        "defect_rework",
      ],
      contact_doc_purpose: [
        "id_card",
        "bank_book",
        "consent",
        "house_registration",
        "insurance",
        "company_cert",
        "vat_cert",
        "contract",
      ],
      contact_status: ["active", "probation", "blacklisted"],
      contractor_category: ["contractor", "dc"],
      contractor_change_status: ["pending", "approved", "rejected"],
      contractor_consent_kind: ["pdpa_data", "background_check"],
      contractor_subtype: [
        "regular",
        "dc_company",
        "dc_regular",
        "dc_temporary",
      ],
      day_fraction: ["full", "half"],
      dc_payment_method: ["bank_transfer", "cash", "cheque"],
      equipment_movement_kind: [
        "received",
        "deployed",
        "returned",
        "maintenance",
        "lost",
      ],
      equipment_status: [
        "available",
        "on_site",
        "in_use",
        "maintenance",
        "returned",
        "lost",
      ],
      equipment_tracking: ["unit", "bulk"],
      gl_account_type: ["asset", "liability", "equity", "income", "expense"],
      gl_posting_status: ["pending", "posting", "posted", "failed", "skipped"],
      journal_entry_status: ["draft", "posted", "reversed"],
      login_handoff_status: ["pending", "approved", "consumed"],
      notification_event_type: [
        "wp_pending_approval",
        "wp_decision",
        "pr_created",
        "pr_decision",
        "pr_progress",
        "pr_cancelled",
      ],
      notification_status: ["pending", "sending", "sent", "failed", "expired"],
      peak_doc_type: ["contact", "expense"],
      peak_entity_type: ["contact", "expense"],
      peak_sync_operation: ["create", "void"],
      peak_sync_status: ["pending", "sending", "sent", "failed", "skipped"],
      photo_phase: ["before", "during", "after"],
      project_status: ["active", "on_hold", "completed", "archived"],
      project_type: [
        "new_building",
        "renovation",
        "factory_warehouse",
        "infrastructure",
        "systems",
        "other",
      ],
      purchase_order_attachment_kind: ["image", "pdf"],
      purchase_order_attachment_purpose: [
        "source_document",
        "proof_of_delivery",
      ],
      purchase_request_attachment_kind: ["image", "link", "pdf"],
      purchase_request_attachment_purpose: [
        "reference",
        "delivery_confirmation",
        "invoice",
      ],
      purchase_request_priority: ["normal", "urgent", "critical"],
      purchase_request_status: [
        "requested",
        "approved",
        "rejected",
        "cancelled",
        "purchased",
        "on_route",
        "delivered",
        "site_purchased",
      ],
      report_status: ["requested", "processing", "complete", "failed"],
      retention_status: ["held", "due", "released", "forfeited"],
      service_subtype: ["transport"],
      user_role: [
        "site_admin",
        "project_manager",
        "super_admin",
        "project_coordinator",
        "procurement",
        "technician",
        "hr",
        "subcon_manager",
        "accounting",
        "visitor",
        "contractor",
        "project_director",
      ],
      wht_direction: ["deducted", "suffered"],
      wht_form: ["pnd3", "pnd53", "pnd1"],
      work_package_priority: ["normal", "urgent", "critical"],
      work_package_status: [
        "not_started",
        "in_progress",
        "on_hold",
        "complete",
        "pending_approval",
        "rework",
      ],
      worker_level: ["senior", "mid", "junior", "apprentice"],
      worker_type: ["own", "dc"],
    },
  },
} as const
