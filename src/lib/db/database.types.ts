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
      boq_line: {
        Row: {
          boq_template_id: string
          catalog_item_id: string | null
          created_at: string
          created_by: string | null
          description: string
          exclusivity_group: string | null
          id: string
          is_standard: boolean
          labor_rate: number
          line_status: Database["public"]["Enums"]["boq_line_status"]
          material_rate: number
          qty: number
          sort_order: number
          unit: string
          updated_at: string
          variation_type: Database["public"]["Enums"]["boq_variation_type"]
          work_category_id: string | null
        }
        Insert: {
          boq_template_id: string
          catalog_item_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          exclusivity_group?: string | null
          id?: string
          is_standard?: boolean
          labor_rate?: number
          line_status?: Database["public"]["Enums"]["boq_line_status"]
          material_rate?: number
          qty: number
          sort_order?: number
          unit: string
          updated_at?: string
          variation_type?: Database["public"]["Enums"]["boq_variation_type"]
          work_category_id?: string | null
        }
        Update: {
          boq_template_id?: string
          catalog_item_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          exclusivity_group?: string | null
          id?: string
          is_standard?: boolean
          labor_rate?: number
          line_status?: Database["public"]["Enums"]["boq_line_status"]
          material_rate?: number
          qty?: number
          sort_order?: number
          unit?: string
          updated_at?: string
          variation_type?: Database["public"]["Enums"]["boq_variation_type"]
          work_category_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_line_boq_template_id_fkey"
            columns: ["boq_template_id"]
            isOneToOne: false
            referencedRelation: "boq_template"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_line_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_line_work_category_id_fkey"
            columns: ["work_category_id"]
            isOneToOne: false
            referencedRelation: "work_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_template: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      catalog_assembly_components: {
        Row: {
          assembly_id: string
          component_item_id: string
          created_at: string
          created_by: string | null
          id: string
          qty_per: number
          waste_factor: number
        }
        Insert: {
          assembly_id: string
          component_item_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          qty_per: number
          waste_factor?: number
        }
        Update: {
          assembly_id?: string
          component_item_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          qty_per?: number
          waste_factor?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_assembly_components_assembly_id_fkey"
            columns: ["assembly_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_assembly_components_component_item_id_fkey"
            columns: ["component_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_categories: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          legacy_category: Database["public"]["Enums"]["item_category"] | null
          name: string
          name_en: string | null
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          legacy_category?: Database["public"]["Enums"]["item_category"] | null
          name: string
          name_en?: string | null
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          legacy_category?: Database["public"]["Enums"]["item_category"] | null
          name?: string
          name_en?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      catalog_item_categories: {
        Row: {
          catalog_item_id: string
          category_id: string
          created_at: string
          created_by: string | null
          id: string
          is_primary: boolean
          subcategory_id: string | null
        }
        Insert: {
          catalog_item_id: string
          category_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          subcategory_id?: string | null
        }
        Update: {
          catalog_item_id?: string
          category_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          subcategory_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_item_categories_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_item_categories_category_id_fk"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "catalog_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_item_categories_subcategory_category_id_fk"
            columns: ["subcategory_id", "category_id"]
            isOneToOne: false
            referencedRelation: "catalog_subcategories"
            referencedColumns: ["id", "category_id"]
          },
        ]
      }
      catalog_items: {
        Row: {
          base_item: string
          category: Database["public"]["Enums"]["item_category"] | null
          category_id: string | null
          created_at: string
          fulfillment_mode: Database["public"]["Enums"]["catalog_fulfillment_mode"]
          id: string
          image_path: string | null
          is_active: boolean
          kind: Database["public"]["Enums"]["catalog_item_kind"]
          lead_time_days: number | null
          note: string | null
          owner_supplied: boolean
          product_code: string | null
          search_terms: string | null
          spec_attrs: string | null
          stockable: boolean
          subcategory_id: string | null
          unit: string
        }
        Insert: {
          base_item: string
          category?: Database["public"]["Enums"]["item_category"] | null
          category_id?: string | null
          created_at?: string
          fulfillment_mode?: Database["public"]["Enums"]["catalog_fulfillment_mode"]
          id?: string
          image_path?: string | null
          is_active?: boolean
          kind?: Database["public"]["Enums"]["catalog_item_kind"]
          lead_time_days?: number | null
          note?: string | null
          owner_supplied?: boolean
          product_code?: string | null
          search_terms?: string | null
          spec_attrs?: string | null
          stockable?: boolean
          subcategory_id?: string | null
          unit: string
        }
        Update: {
          base_item?: string
          category?: Database["public"]["Enums"]["item_category"] | null
          category_id?: string | null
          created_at?: string
          fulfillment_mode?: Database["public"]["Enums"]["catalog_fulfillment_mode"]
          id?: string
          image_path?: string | null
          is_active?: boolean
          kind?: Database["public"]["Enums"]["catalog_item_kind"]
          lead_time_days?: number | null
          note?: string | null
          owner_supplied?: boolean
          product_code?: string | null
          search_terms?: string | null
          spec_attrs?: string | null
          stockable?: boolean
          subcategory_id?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "catalog_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_items_subcategory_category_id_fk"
            columns: ["subcategory_id", "category_id"]
            isOneToOne: false
            referencedRelation: "catalog_subcategories"
            referencedColumns: ["id", "category_id"]
          },
          {
            foreignKeyName: "catalog_items_subcategory_fk"
            columns: ["subcategory_id", "category"]
            isOneToOne: false
            referencedRelation: "catalog_subcategories"
            referencedColumns: ["id", "category"]
          },
        ]
      }
      catalog_subcategories: {
        Row: {
          category: Database["public"]["Enums"]["item_category"] | null
          category_id: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          category?: Database["public"]["Enums"]["item_category"] | null
          category_id?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          category?: Database["public"]["Enums"]["item_category"] | null
          category_id?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_subcategories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "catalog_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_units: {
        Row: {
          abbr_short: string | null
          code: string
          created_at: string
          created_by: string | null
          display_name: string
          is_active: boolean
          sort_order: number
          unit_class: Database["public"]["Enums"]["unit_class"]
          updated_at: string
        }
        Insert: {
          abbr_short?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          display_name: string
          is_active?: boolean
          sort_order?: number
          unit_class: Database["public"]["Enums"]["unit_class"]
          updated_at?: string
        }
        Update: {
          abbr_short?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          is_active?: boolean
          sort_order?: number
          unit_class?: Database["public"]["Enums"]["unit_class"]
          updated_at?: string
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
          installment_id: string | null
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
          installment_id?: string | null
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
          installment_id?: string | null
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
            foreignKeyName: "client_billings_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "contract_installments"
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
      client_invites: {
        Row: {
          access_expires_at: string
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          created_by: string
          id: string
          project_id: string
          tier: Database["public"]["Enums"]["client_access_tier"]
          token_hash: string
        }
        Insert: {
          access_expires_at: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by: string
          id?: string
          project_id: string
          tier?: Database["public"]["Enums"]["client_access_tier"]
          token_hash: string
        }
        Update: {
          access_expires_at?: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          project_id?: string
          tier?: Database["public"]["Enums"]["client_access_tier"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_invites_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_access: {
        Row: {
          expires_at: string | null
          granted_at: string
          granted_by: string
          id: string
          project_id: string
          revoked_at: string | null
          revoked_by: string | null
          tier: Database["public"]["Enums"]["client_access_tier"]
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          granted_at?: string
          granted_by: string
          id?: string
          project_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          tier?: Database["public"]["Enums"]["client_access_tier"]
          user_id: string
        }
        Update: {
          expires_at?: string | null
          granted_at?: string
          granted_by?: string
          id?: string
          project_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          tier?: Database["public"]["Enums"]["client_access_tier"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_access_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_access_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_pos: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          document_path: string | null
          id: string
          note: string | null
          po_date: string
          po_no: string
          project_id: string
          quotation_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          document_path?: string | null
          id?: string
          note?: string | null
          po_date: string
          po_no: string
          project_id: string
          quotation_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          document_path?: string | null
          id?: string
          note?: string | null
          po_date?: string
          po_no?: string
          project_id?: string
          quotation_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_pos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_pos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_pos_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_receipts: {
        Row: {
          amount: number | null
          client_billing_id: string | null
          created_at: string
          created_by: string
          id: string
          method: Database["public"]["Enums"]["receipt_method"] | null
          note: string | null
          project_id: string
          received_date: string | null
          superseded_by: string | null
        }
        Insert: {
          amount?: number | null
          client_billing_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          method?: Database["public"]["Enums"]["receipt_method"] | null
          note?: string | null
          project_id: string
          received_date?: string | null
          superseded_by?: string | null
        }
        Update: {
          amount?: number | null
          client_billing_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          method?: Database["public"]["Enums"]["receipt_method"] | null
          note?: string | null
          project_id?: string
          received_date?: string | null
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_receipts_client_billing_id_fkey"
            columns: ["client_billing_id"]
            isOneToOne: false
            referencedRelation: "client_billings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_receipts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_receipts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_receipts_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "client_receipts"
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
      company_cards: {
        Row: {
          created_at: string
          created_by: string
          holder_user_id: string
          id: string
          is_active: boolean
          label: string
          last4: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          holder_user_id: string
          id?: string
          is_active?: boolean
          label: string
          last4?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          holder_user_id?: string
          id?: string
          is_active?: boolean
          label?: string
          last4?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_cards_holder_user_id_fkey"
            columns: ["holder_user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      contract_attachments: {
        Row: {
          contract_id: string
          created_at: string
          id: string
          storage_path: string
          superseded_by: string | null
          uploaded_by: string | null
        }
        Insert: {
          contract_id: string
          created_at?: string
          id?: string
          storage_path: string
          superseded_by?: string | null
          uploaded_by?: string | null
        }
        Update: {
          contract_id?: string
          created_at?: string
          id?: string
          storage_path?: string
          superseded_by?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_attachments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_attachments_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "contract_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_installments: {
        Row: {
          amount: number
          contract_id: string
          created_at: string
          id: string
          label: string
          planned_date: string | null
          seq: number
          updated_at: string
        }
        Insert: {
          amount: number
          contract_id: string
          created_at?: string
          id?: string
          label: string
          planned_date?: string | null
          seq: number
          updated_at?: string
        }
        Update: {
          amount?: number
          contract_id?: string
          created_at?: string
          id?: string
          label?: string
          planned_date?: string | null
          seq?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_installments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "project_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_bank_change_requests: {
        Row: {
          bank_account_name: string | null
          bank_account_no: string | null
          bank_book_path: string | null
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
          bank_book_path?: string | null
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
          bank_book_path?: string | null
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
          contractor_id: string | null
          created_at: string
          document_id: string | null
          id: string
          kind: Database["public"]["Enums"]["contractor_consent_kind"]
          recorded_by: string
          revoked_at: string | null
          worker_id: string | null
        }
        Insert: {
          consented_at?: string
          contractor_id?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["contractor_consent_kind"]
          recorded_by: string
          revoked_at?: string | null
          worker_id?: string | null
        }
        Update: {
          consented_at?: string
          contractor_id?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["contractor_consent_kind"]
          recorded_by?: string
          revoked_at?: string | null
          worker_id?: string | null
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
          {
            foreignKeyName: "contractor_consents_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
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
          token_hash: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          contractor_id: string
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          token_hash: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          contractor_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          token_hash?: string
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
      contracts: {
        Row: {
          agreed_amount: number | null
          contract_type: Database["public"]["Enums"]["contract_type"]
          counterparty_name: string
          counterparty_type: Database["public"]["Enums"]["contract_counterparty_type"]
          created_at: string
          created_by: string | null
          currency: string
          document_path: string | null
          effective_date: string | null
          expiry_date: string | null
          id: string
          project_id: string | null
          sign_date: string | null
          status: Database["public"]["Enums"]["contract_status"]
          title: string
          updated_at: string
        }
        Insert: {
          agreed_amount?: number | null
          contract_type: Database["public"]["Enums"]["contract_type"]
          counterparty_name: string
          counterparty_type: Database["public"]["Enums"]["contract_counterparty_type"]
          created_at?: string
          created_by?: string | null
          currency?: string
          document_path?: string | null
          effective_date?: string | null
          expiry_date?: string | null
          id?: string
          project_id?: string | null
          sign_date?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          title: string
          updated_at?: string
        }
        Update: {
          agreed_amount?: number | null
          contract_type?: Database["public"]["Enums"]["contract_type"]
          counterparty_name?: string
          counterparty_type?: Database["public"]["Enums"]["contract_counterparty_type"]
          created_at?: string
          created_by?: string | null
          currency?: string
          document_path?: string | null
          effective_date?: string | null
          expiry_date?: string | null
          id?: string
          project_id?: string | null
          sign_date?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_members: {
        Row: {
          added_at: string
          added_by: string
          crew_id: string
          id: string
          removed_at: string | null
          worker_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          crew_id: string
          id?: string
          removed_at?: string | null
          worker_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          crew_id?: string
          id?: string
          removed_at?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_members_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_members_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_registrations: {
        Row: {
          created_at: string
          crew_id: string
          date_of_birth: string
          employee_id: string
          full_name: string
          id: string
          national_id: string
          onboarded_by_worker: string | null
          phone: string | null
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["crew_registration_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          crew_id: string
          date_of_birth: string
          employee_id: string
          full_name: string
          id?: string
          national_id: string
          onboarded_by_worker?: string | null
          phone?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["crew_registration_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          crew_id?: string
          date_of_birth?: string
          employee_id?: string
          full_name?: string
          id?: string
          national_id?: string
          onboarded_by_worker?: string | null
          phone?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["crew_registration_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_registrations_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_registrations_onboarded_by_worker_fkey"
            columns: ["onboarded_by_worker"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_registrations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      crews: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          default_day_rate: number | null
          id: string
          kind: string
          lead_worker_id: string | null
          name: string
          project_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          default_day_rate?: number | null
          id?: string
          kind?: string
          lead_worker_id?: string | null
          name: string
          project_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          default_day_rate?: number | null
          id?: string
          kind?: string
          lead_worker_id?: string | null
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crews_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crews_lead_worker_id_fkey"
            columns: ["lead_worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_work_plan_crew: {
        Row: {
          created_at: string
          id: string
          is_lead: boolean
          item_id: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_lead?: boolean
          item_id: string
          worker_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_lead?: boolean
          item_id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_work_plan_crew_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "daily_work_plan_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_work_plan_crew_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_work_plan_items: {
        Row: {
          created_at: string
          id: string
          note: string | null
          plan_id: string
          sort_order: number
          updated_at: string
          work_package_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          plan_id: string
          sort_order?: number
          updated_at?: string
          work_package_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          plan_id?: string
          sort_order?: number
          updated_at?: string
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_work_plan_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "daily_work_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_work_plan_items_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_work_plans: {
        Row: {
          created_at: string
          created_by: string
          id: string
          plan_date: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          plan_date: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          plan_date?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_work_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_work_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      departments: {
        Row: {
          created_at: string
          head_user_id: string | null
          id: string
          is_active: boolean
          key: string
          name_en: string
          name_th: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          head_user_id?: string | null
          id?: string
          is_active?: boolean
          key: string
          name_en: string
          name_th: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          head_user_id?: string | null
          id?: string
          is_active?: boolean
          key?: string
          name_en?: string
          name_th?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "departments_head_user_id_fkey"
            columns: ["head_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      document_approvals: {
        Row: {
          actor_id: string | null
          comment: string
          contract_id: string
          created_at: string
          decision: Database["public"]["Enums"]["document_decision"]
          id: string
          target_type: Database["public"]["Enums"]["document_target_type"]
        }
        Insert: {
          actor_id?: string | null
          comment: string
          contract_id: string
          created_at?: string
          decision: Database["public"]["Enums"]["document_decision"]
          id?: string
          target_type?: Database["public"]["Enums"]["document_target_type"]
        }
        Update: {
          actor_id?: string | null
          comment?: string
          contract_id?: string
          created_at?: string
          decision?: Database["public"]["Enums"]["document_decision"]
          id?: string
          target_type?: Database["public"]["Enums"]["document_target_type"]
        }
        Relationships: [
          {
            foreignKeyName: "document_approvals_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_approvals_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_id_counters: {
        Row: {
          next_val: number
          year: number
        }
        Insert: {
          next_val: number
          year: number
        }
        Update: {
          next_val?: number
          year?: number
        }
        Relationships: []
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
          rental_agreement_id: string | null
          status: Database["public"]["Enums"]["equipment_status"]
          supplier_id: string | null
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
          rental_agreement_id?: string | null
          status?: Database["public"]["Enums"]["equipment_status"]
          supplier_id?: string | null
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
          rental_agreement_id?: string | null
          status?: Database["public"]["Enums"]["equipment_status"]
          supplier_id?: string | null
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
          {
            foreignKeyName: "equipment_items_rental_agreement_id_fkey"
            columns: ["rental_agreement_id"]
            isOneToOne: false
            referencedRelation: "equipment_rental_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
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
          deposit_amount: number
          deposit_paid_date: string | null
          ends_on: string | null
          id: string
          min_rental_days: number | null
          monthly_rate: number
          note: string | null
          owner_id: string | null
          rate_period: Database["public"]["Enums"]["equipment_rate_period"]
          starts_on: string
          status: Database["public"]["Enums"]["rental_agreement_status"]
          supplier_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          deposit_amount?: number
          deposit_paid_date?: string | null
          ends_on?: string | null
          id?: string
          min_rental_days?: number | null
          monthly_rate: number
          note?: string | null
          owner_id?: string | null
          rate_period?: Database["public"]["Enums"]["equipment_rate_period"]
          starts_on: string
          status?: Database["public"]["Enums"]["rental_agreement_status"]
          supplier_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          deposit_amount?: number
          deposit_paid_date?: string | null
          ends_on?: string | null
          id?: string
          min_rental_days?: number | null
          monthly_rate?: number
          note?: string | null
          owner_id?: string | null
          rate_period?: Database["public"]["Enums"]["equipment_rate_period"]
          starts_on?: string
          status?: Database["public"]["Enums"]["rental_agreement_status"]
          supplier_id?: string | null
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
          {
            foreignKeyName: "equipment_rental_batches_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
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
      feedback: {
        Row: {
          app_version: string | null
          body: string
          created_at: string
          feedback_number: number
          id: string
          page_path: string | null
          role_snapshot: Database["public"]["Enums"]["user_role"]
          screen: string | null
          status: Database["public"]["Enums"]["feedback_status"]
          submitted_by: string
          title: string
          type: Database["public"]["Enums"]["feedback_type"]
          user_agent: string | null
        }
        Insert: {
          app_version?: string | null
          body: string
          created_at?: string
          feedback_number?: number
          id?: string
          page_path?: string | null
          role_snapshot: Database["public"]["Enums"]["user_role"]
          screen?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          submitted_by: string
          title: string
          type: Database["public"]["Enums"]["feedback_type"]
          user_agent?: string | null
        }
        Update: {
          app_version?: string | null
          body?: string
          created_at?: string
          feedback_number?: number
          id?: string
          page_path?: string | null
          role_snapshot?: Database["public"]["Enums"]["user_role"]
          screen?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          submitted_by?: string
          title?: string
          type?: Database["public"]["Enums"]["feedback_type"]
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_attachments: {
        Row: {
          created_at: string
          feedback_id: string
          id: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          feedback_id: string
          id?: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          feedback_id?: string
          id?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_attachments_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "feedback"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_message_drafts: {
        Row: {
          body: string
          created_at: string
          feedback_id: string
          id: string
        }
        Insert: {
          body: string
          created_at?: string
          feedback_id: string
          id?: string
        }
        Update: {
          body?: string
          created_at?: string
          feedback_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_message_drafts_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "feedback"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_messages: {
        Row: {
          author_id: string | null
          author_kind: Database["public"]["Enums"]["feedback_author_kind"]
          body: string
          created_at: string
          feedback_id: string
          id: string
        }
        Insert: {
          author_id?: string | null
          author_kind: Database["public"]["Enums"]["feedback_author_kind"]
          body: string
          created_at?: string
          feedback_id: string
          id?: string
        }
        Update: {
          author_id?: string | null
          author_kind?: Database["public"]["Enums"]["feedback_author_kind"]
          body?: string
          created_at?: string
          feedback_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_messages_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "feedback"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_views: {
        Row: {
          feedback_id: string
          last_viewed_at: string
          user_id: string
        }
        Insert: {
          feedback_id: string
          last_viewed_at?: string
          user_id: string
        }
        Update: {
          feedback_id?: string
          last_viewed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_views_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "feedback"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      identity_change_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          proposed_dob: string | null
          proposed_full_name: string | null
          proposed_national_id: string | null
          status: Database["public"]["Enums"]["contractor_change_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          proposed_dob?: string | null
          proposed_full_name?: string | null
          proposed_national_id?: string | null
          status?: Database["public"]["Enums"]["contractor_change_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          proposed_dob?: string | null
          proposed_full_name?: string | null
          proposed_national_id?: string | null
          status?: Database["public"]["Enums"]["contractor_change_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_change_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_change_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      integrity_check_runs: {
        Row: {
          domain: string
          drift: number | null
          id: number
          key: string
          offending_count: number | null
          ran_at: string
          run_id: string
          sample: Json | null
          severity: string
          status: string
          trigger: string
        }
        Insert: {
          domain: string
          drift?: number | null
          id?: never
          key: string
          offending_count?: number | null
          ran_at?: string
          run_id: string
          sample?: Json | null
          severity: string
          status: string
          trigger: string
        }
        Update: {
          domain?: string
          drift?: number | null
          id?: never
          key?: string
          offending_count?: number | null
          ran_at?: string
          run_id?: string
          sample?: Json | null
          severity?: string
          status?: string
          trigger?: string
        }
        Relationships: []
      }
      interaction_events: {
        Row: {
          actor_id: string
          actor_role: Database["public"]["Enums"]["user_role"]
          app_version: string | null
          client_ts: string | null
          context: Json | null
          created_at: string
          event_type: Database["public"]["Enums"]["interaction_event_type"]
          id: string
          route: string | null
          session_id: string
        }
        Insert: {
          actor_id: string
          actor_role: Database["public"]["Enums"]["user_role"]
          app_version?: string | null
          client_ts?: string | null
          context?: Json | null
          created_at?: string
          event_type: Database["public"]["Enums"]["interaction_event_type"]
          id?: string
          route?: string | null
          session_id: string
        }
        Update: {
          actor_id?: string
          actor_role?: Database["public"]["Enums"]["user_role"]
          app_version?: string | null
          client_ts?: string | null
          context?: Json | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["interaction_event_type"]
          id?: string
          route?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interaction_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      item_sell_rates: {
        Row: {
          catalog_item_id: string
          sell_rate: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          catalog_item_id: string
          sell_rate: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          catalog_item_id?: string
          sell_rate?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_sell_rates_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: true
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_sell_rates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
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
          correction_reason: string | null
          created_at: string
          day_fraction: Database["public"]["Enums"]["day_fraction"] | null
          day_rate_snapshot: number
          entered_by: string
          id: string
          note: string | null
          pay_type_snapshot: Database["public"]["Enums"]["pay_type"]
          self_logged: boolean
          superseded_by: string | null
          wht_pct_snapshot: number | null
          work_date: string
          work_package_id: string
          worker_id: string
          worker_name_snapshot: string
        }
        Insert: {
          correction_reason?: string | null
          created_at?: string
          day_fraction?: Database["public"]["Enums"]["day_fraction"] | null
          day_rate_snapshot: number
          entered_by: string
          id?: string
          note?: string | null
          pay_type_snapshot: Database["public"]["Enums"]["pay_type"]
          self_logged?: boolean
          superseded_by?: string | null
          wht_pct_snapshot?: number | null
          work_date: string
          work_package_id: string
          worker_id: string
          worker_name_snapshot: string
        }
        Update: {
          correction_reason?: string | null
          created_at?: string
          day_fraction?: Database["public"]["Enums"]["day_fraction"] | null
          day_rate_snapshot?: number
          entered_by?: string
          id?: string
          note?: string | null
          pay_type_snapshot?: Database["public"]["Enums"]["pay_type"]
          self_logged?: boolean
          superseded_by?: string | null
          wht_pct_snapshot?: number | null
          work_date?: string
          work_package_id?: string
          worker_id?: string
          worker_name_snapshot?: string
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
      labor_wht_config: {
        Row: {
          id: boolean
          updated_at: string
          updated_by: string | null
          wht_pct: number | null
        }
        Insert: {
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          wht_pct?: number | null
        }
        Update: {
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          wht_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "labor_wht_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      muster_attendance: {
        Row: {
          id: string
          in_at: string
          in_method: Database["public"]["Enums"]["muster_method"]
          note: string | null
          ot_hours: number | null
          out_at: string | null
          out_auto: boolean
          out_method: Database["public"]["Enums"]["muster_method"] | null
          scanned_by: string
          team_id: string
          work_date: string
          worker_id: string
        }
        Insert: {
          id?: string
          in_at?: string
          in_method: Database["public"]["Enums"]["muster_method"]
          note?: string | null
          ot_hours?: number | null
          out_at?: string | null
          out_auto?: boolean
          out_method?: Database["public"]["Enums"]["muster_method"] | null
          scanned_by: string
          team_id: string
          work_date: string
          worker_id: string
        }
        Update: {
          id?: string
          in_at?: string
          in_method?: Database["public"]["Enums"]["muster_method"]
          note?: string | null
          ot_hours?: number | null
          out_at?: string | null
          out_auto?: boolean
          out_method?: Database["public"]["Enums"]["muster_method"] | null
          scanned_by?: string
          team_id?: string
          work_date?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "muster_attendance_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "muster_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "muster_attendance_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      muster_day_closures: {
        Row: {
          closed_at: string
          closed_by: string
          project_id: string
          work_date: string
        }
        Insert: {
          closed_at?: string
          closed_by: string
          project_id: string
          work_date: string
        }
        Update: {
          closed_at?: string
          closed_by?: string
          project_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "muster_day_closures_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      muster_team_wps: {
        Row: {
          team_id: string
          work_package_id: string
        }
        Insert: {
          team_id: string
          work_package_id: string
        }
        Update: {
          team_id?: string
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "muster_team_wps_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "muster_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "muster_team_wps_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      muster_teams: {
        Row: {
          created_at: string
          created_by: string
          id: string
          lead_worker_id: string
          project_id: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          lead_worker_id: string
          project_id: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          lead_worker_id?: string
          project_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "muster_teams_lead_worker_id_fkey"
            columns: ["lead_worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "muster_teams_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      office_expense_attachments: {
        Row: {
          created_at: string
          created_by: string
          id: string
          office_expense_id: string
          purpose:
            | Database["public"]["Enums"]["office_expense_doc_purpose"]
            | null
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id: string
          office_expense_id: string
          purpose?:
            | Database["public"]["Enums"]["office_expense_doc_purpose"]
            | null
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          office_expense_id?: string
          purpose?:
            | Database["public"]["Enums"]["office_expense_doc_purpose"]
            | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "office_expense_attachments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_expense_attachments_office_expense_id_fkey"
            columns: ["office_expense_id"]
            isOneToOne: false
            referencedRelation: "office_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      office_expense_categories: {
        Row: {
          created_at: string
          gl_account_code: string | null
          id: string
          is_active: boolean
          label_en: string | null
          label_th: string
          sort: number
        }
        Insert: {
          created_at?: string
          gl_account_code?: string | null
          id?: string
          is_active?: boolean
          label_en?: string | null
          label_th: string
          sort?: number
        }
        Update: {
          created_at?: string
          gl_account_code?: string | null
          id?: string
          is_active?: boolean
          label_en?: string | null
          label_th?: string
          sort?: number
        }
        Relationships: []
      }
      office_expenses: {
        Row: {
          amount: number
          category_id: string
          company_card_id: string | null
          created_at: string
          description: string
          expense_date: string
          id: string
          payment_source: Database["public"]["Enums"]["payment_source"]
          project_id: string | null
          reimburse_to_user_id: string | null
          reimbursed_at: string | null
          reimbursed_by: string | null
          submitted_by: string
        }
        Insert: {
          amount: number
          category_id: string
          company_card_id?: string | null
          created_at?: string
          description: string
          expense_date: string
          id?: string
          payment_source: Database["public"]["Enums"]["payment_source"]
          project_id?: string | null
          reimburse_to_user_id?: string | null
          reimbursed_at?: string | null
          reimbursed_by?: string | null
          submitted_by: string
        }
        Update: {
          amount?: number
          category_id?: string
          company_card_id?: string | null
          created_at?: string
          description?: string
          expense_date?: string
          id?: string
          payment_source?: Database["public"]["Enums"]["payment_source"]
          project_id?: string | null
          reimburse_to_user_id?: string | null
          reimbursed_at?: string | null
          reimbursed_by?: string | null
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "office_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "office_expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_expenses_company_card_id_fkey"
            columns: ["company_card_id"]
            isOneToOne: false
            referencedRelation: "company_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_expenses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_expenses_reimburse_to_user_id_fkey"
            columns: ["reimburse_to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_expenses_reimbursed_by_fkey"
            columns: ["reimbursed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_expenses_submitted_by_fkey"
            columns: ["submitted_by"]
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
          answers_photo_id: string | null
          captured_at_client: string | null
          created_at: string
          id: string
          phase: Database["public"]["Enums"]["photo_phase"]
          rework_round: number
          storage_path: string | null
          superseded_by: string | null
          uploaded_by: string
          work_package_id: string
        }
        Insert: {
          answers_photo_id?: string | null
          captured_at_client?: string | null
          created_at?: string
          id?: string
          phase: Database["public"]["Enums"]["photo_phase"]
          rework_round?: number
          storage_path?: string | null
          superseded_by?: string | null
          uploaded_by: string
          work_package_id: string
        }
        Update: {
          answers_photo_id?: string | null
          captured_at_client?: string | null
          created_at?: string
          id?: string
          phase?: Database["public"]["Enums"]["photo_phase"]
          rework_round?: number
          storage_path?: string | null
          superseded_by?: string | null
          uploaded_by?: string
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_logs_answers_photo_id_fkey"
            columns: ["answers_photo_id"]
            isOneToOne: false
            referencedRelation: "photo_logs"
            referencedColumns: ["id"]
          },
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
      plan_baseline_items: {
        Row: {
          baseline_id: string
          planned_end: string
          planned_start: string
          work_package_id: string
        }
        Insert: {
          baseline_id: string
          planned_end: string
          planned_start: string
          work_package_id: string
        }
        Update: {
          baseline_id?: string
          planned_end?: string
          planned_start?: string
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_baseline_items_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "plan_baselines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_baseline_items_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_baselines: {
        Row: {
          approved_by: string | null
          as_of: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["plan_baseline_kind"]
          project_id: string
          proposed_by: string | null
          reason: string | null
          scoring_go_live: string | null
          version: number
        }
        Insert: {
          approved_by?: string | null
          as_of?: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["plan_baseline_kind"]
          project_id: string
          proposed_by?: string | null
          reason?: string | null
          scoring_go_live?: string | null
          version: number
        }
        Update: {
          approved_by?: string | null
          as_of?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["plan_baseline_kind"]
          project_id?: string
          proposed_by?: string | null
          reason?: string | null
          scoring_go_live?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "plan_baselines_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_baselines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_baselines_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_categories: {
        Row: {
          code: string
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          name: string
          project_id: string
          sort_order: number
          updated_at: string
          work_category_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          name: string
          project_id: string
          sort_order: number
          updated_at?: string
          work_category_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          name?: string
          project_id?: string
          sort_order?: number
          updated_at?: string
          work_category_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_categories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_categories_work_category_id_fkey"
            columns: ["work_category_id"]
            isOneToOne: false
            referencedRelation: "work_categories"
            referencedColumns: ["id"]
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
      project_contracts: {
        Row: {
          client_po_id: string | null
          contract_no: string | null
          contract_value: number
          created_at: string
          created_by: string
          document_path: string | null
          end_date: string | null
          id: string
          note: string | null
          project_id: string
          quotation_id: string | null
          retention_rate: number
          sign_date: string | null
          start_date: string | null
          updated_at: string
        }
        Insert: {
          client_po_id?: string | null
          contract_no?: string | null
          contract_value: number
          created_at?: string
          created_by: string
          document_path?: string | null
          end_date?: string | null
          id?: string
          note?: string | null
          project_id: string
          quotation_id?: string | null
          retention_rate?: number
          sign_date?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          client_po_id?: string | null
          contract_no?: string | null
          contract_value?: number
          created_at?: string
          created_by?: string
          document_path?: string | null
          end_date?: string | null
          id?: string
          note?: string | null
          project_id?: string
          quotation_id?: string | null
          retention_rate?: number
          sign_date?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_contracts_client_po_id_fkey"
            columns: ["client_po_id"]
            isOneToOne: false
            referencedRelation: "client_pos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_contracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_contracts_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          added_at: string
          added_by: string
          is_primary: boolean
          project_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          is_primary?: boolean
          project_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          is_primary?: boolean
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
          gmap_url: string | null
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
          gmap_url?: string | null
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
          gmap_url?: string | null
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
      purchase_order_charges: {
        Row: {
          amount: number
          charge_type: Database["public"]["Enums"]["po_charge_type"]
          created_at: string
          created_by: string
          id: string
          note: string | null
          purchase_order_id: string
          vat_rate: number
        }
        Insert: {
          amount: number
          charge_type: Database["public"]["Enums"]["po_charge_type"]
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          purchase_order_id: string
          vat_rate?: number
        }
        Update: {
          amount?: number
          charge_type?: Database["public"]["Enums"]["po_charge_type"]
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          purchase_order_id?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_charges_purchase_order_id_fkey"
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
      purchase_quotes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          purchase_request_id: string
          supplier_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          purchase_request_id: string
          supplier_id: string
          unit_price: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          purchase_request_id?: string
          supplier_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_quotes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_quotes_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_quotes_supplier_id_fkey"
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
          quote_id: string | null
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
          quote_id?: string | null
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
          quote_id?: string | null
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
          {
            foreignKeyName: "purchase_request_attachments_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "purchase_quotes"
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
          catalog_item_id: string | null
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
          project_id: string
          purchase_order_id: string | null
          purchased_at: string | null
          quantity: number
          reason_code:
            | Database["public"]["Enums"]["purchase_request_reason_code"]
            | null
          received_by: string | null
          received_by_id: string | null
          requested_at: string
          requested_by: string | null
          requested_by_email: string | null
          requested_from_work_package_id: string | null
          shipped_at: string | null
          source: string
          split_from_request_id: string | null
          status: Database["public"]["Enums"]["purchase_request_status"]
          supplier: string | null
          supplier_id: string | null
          supply_plan_line_id: string | null
          unit: string
          updated_at: string
          vat_rate: number
          work_package_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          amount?: number | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          catalog_item_id?: string | null
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
          project_id: string
          purchase_order_id?: string | null
          purchased_at?: string | null
          quantity: number
          reason_code?:
            | Database["public"]["Enums"]["purchase_request_reason_code"]
            | null
          received_by?: string | null
          received_by_id?: string | null
          requested_at?: string
          requested_by?: string | null
          requested_by_email?: string | null
          requested_from_work_package_id?: string | null
          shipped_at?: string | null
          source?: string
          split_from_request_id?: string | null
          status?: Database["public"]["Enums"]["purchase_request_status"]
          supplier?: string | null
          supplier_id?: string | null
          supply_plan_line_id?: string | null
          unit: string
          updated_at?: string
          vat_rate?: number
          work_package_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          amount?: number | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          catalog_item_id?: string | null
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
          project_id?: string
          purchase_order_id?: string | null
          purchased_at?: string | null
          quantity?: number
          reason_code?:
            | Database["public"]["Enums"]["purchase_request_reason_code"]
            | null
          received_by?: string | null
          received_by_id?: string | null
          requested_at?: string
          requested_by?: string | null
          requested_by_email?: string | null
          requested_from_work_package_id?: string | null
          shipped_at?: string | null
          source?: string
          split_from_request_id?: string | null
          status?: Database["public"]["Enums"]["purchase_request_status"]
          supplier?: string | null
          supplier_id?: string | null
          supply_plan_line_id?: string | null
          unit?: string
          updated_at?: string
          vat_rate?: number
          work_package_id?: string | null
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
            foreignKeyName: "purchase_requests_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
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
            foreignKeyName: "purchase_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
            foreignKeyName: "purchase_requests_requested_from_work_package_id_fkey"
            columns: ["requested_from_work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
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
            foreignKeyName: "purchase_requests_supply_plan_line_id_fkey"
            columns: ["supply_plan_line_id"]
            isOneToOne: false
            referencedRelation: "supply_plan_lines"
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
      quotations: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          document_path: string | null
          id: string
          note: string | null
          project_id: string
          quotation_no: string
          quote_date: string
          status: Database["public"]["Enums"]["quotation_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          document_path?: string | null
          id?: string
          note?: string | null
          project_id: string
          quotation_no: string
          quote_date: string
          status?: Database["public"]["Enums"]["quotation_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          document_path?: string | null
          id?: string
          note?: string | null
          project_id?: string
          quotation_no?: string
          quote_date?: string
          status?: Database["public"]["Enums"]["quotation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_charges: {
        Row: {
          amount: number
          charge_type: Database["public"]["Enums"]["rental_charge_type"]
          created_at: string
          created_by: string
          id: string
          note: string | null
          rental_batch_id: string
          vat_rate: number
        }
        Insert: {
          amount: number
          charge_type: Database["public"]["Enums"]["rental_charge_type"]
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          rental_batch_id: string
          vat_rate?: number
        }
        Update: {
          amount?: number
          charge_type?: Database["public"]["Enums"]["rental_charge_type"]
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          rental_batch_id?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "rental_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_charges_rental_batch_id_fkey"
            columns: ["rental_batch_id"]
            isOneToOne: false
            referencedRelation: "equipment_rental_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_settlements: {
        Row: {
          agreement_id: string
          base_amount: number
          correction_reason: string | null
          created_at: string
          created_by: string
          deposit_forfeited: number
          deposit_refunded: number
          fees_amount: number
          id: string
          invoice_date: string
          invoice_no: string
          method: Database["public"]["Enums"]["receipt_method"]
          net_amount: number
          note: string | null
          overtime_amount: number
          superseded_by: string | null
          vat_amount: number
          wht_amount: number
        }
        Insert: {
          agreement_id: string
          base_amount?: number
          correction_reason?: string | null
          created_at?: string
          created_by: string
          deposit_forfeited?: number
          deposit_refunded?: number
          fees_amount?: number
          id?: string
          invoice_date: string
          invoice_no: string
          method: Database["public"]["Enums"]["receipt_method"]
          net_amount: number
          note?: string | null
          overtime_amount?: number
          superseded_by?: string | null
          vat_amount?: number
          wht_amount?: number
        }
        Update: {
          agreement_id?: string
          base_amount?: number
          correction_reason?: string | null
          created_at?: string
          created_by?: string
          deposit_forfeited?: number
          deposit_refunded?: number
          fees_amount?: number
          id?: string
          invoice_date?: string
          invoice_no?: string
          method?: Database["public"]["Enums"]["receipt_method"]
          net_amount?: number
          note?: string | null
          overtime_amount?: number
          superseded_by?: string | null
          vat_amount?: number
          wht_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "rental_settlements_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "equipment_rental_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_settlements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_settlements_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "rental_settlements"
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
          is_vat_registered: boolean
          mailing_address: string | null
          name: string
          note: string | null
          payment_terms: string | null
          phone: string | null
          plate_no: string | null
          service_subtype: Database["public"]["Enums"]["service_subtype"]
          status: Database["public"]["Enums"]["contact_status"]
          tax_id: string | null
          vehicle_type: string | null
        }
        Insert: {
          contact_person?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          is_vat_registered?: boolean
          mailing_address?: string | null
          name: string
          note?: string | null
          payment_terms?: string | null
          phone?: string | null
          plate_no?: string | null
          service_subtype?: Database["public"]["Enums"]["service_subtype"]
          status?: Database["public"]["Enums"]["contact_status"]
          tax_id?: string | null
          vehicle_type?: string | null
        }
        Update: {
          contact_person?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          is_vat_registered?: boolean
          mailing_address?: string | null
          name?: string
          note?: string | null
          payment_terms?: string | null
          phone?: string | null
          plate_no?: string | null
          service_subtype?: Database["public"]["Enums"]["service_subtype"]
          status?: Database["public"]["Enums"]["contact_status"]
          tax_id?: string | null
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
      site_issue_attachments: {
        Row: {
          created_at: string
          id: string
          site_issue_id: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          site_issue_id: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          id?: string
          site_issue_id?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_issue_attachments_site_issue_id_fkey"
            columns: ["site_issue_id"]
            isOneToOne: false
            referencedRelation: "site_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_issue_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      site_issues: {
        Row: {
          created_at: string
          id: string
          issue_type: Database["public"]["Enums"]["site_issue_type"]
          note: string | null
          project_id: string
          reported_by: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["site_issue_status"]
          work_package_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          issue_type: Database["public"]["Enums"]["site_issue_type"]
          note?: string | null
          project_id: string
          reported_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["site_issue_status"]
          work_package_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          issue_type?: Database["public"]["Enums"]["site_issue_type"]
          note?: string | null
          project_id?: string
          reported_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["site_issue_status"]
          work_package_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_issues_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_issues_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_issues_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_bank_change_requests: {
        Row: {
          bank_account_name: string | null
          bank_account_number: string | null
          bank_name: string | null
          book_bank_path: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          registration_id: string
          requested_by: string
          status: Database["public"]["Enums"]["contractor_change_status"]
        }
        Insert: {
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          book_bank_path: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          registration_id: string
          requested_by: string
          status?: Database["public"]["Enums"]["contractor_change_status"]
        }
        Update: {
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          book_bank_path?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          registration_id?: string
          requested_by?: string
          status?: Database["public"]["Enums"]["contractor_change_status"]
        }
        Relationships: [
          {
            foreignKeyName: "staff_bank_change_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_bank_change_requests_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "staff_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_bank_change_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_consents: {
        Row: {
          consented_at: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["staff_consent_kind"]
          recorded_by: string
          registration_id: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          consented_at?: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["staff_consent_kind"]
          recorded_by: string
          registration_id: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          consented_at?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["staff_consent_kind"]
          recorded_by?: string
          registration_id?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_consents_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "staff_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_registration_attachments: {
        Row: {
          created_at: string
          id: string
          purpose: Database["public"]["Enums"]["staff_doc_purpose"]
          registration_id: string
          storage_path: string
          superseded_by: string | null
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          purpose: Database["public"]["Enums"]["staff_doc_purpose"]
          registration_id: string
          storage_path: string
          superseded_by?: string | null
          uploaded_by: string
        }
        Update: {
          created_at?: string
          id?: string
          purpose?: Database["public"]["Enums"]["staff_doc_purpose"]
          registration_id?: string
          storage_path?: string
          superseded_by?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "technician_registration_attachments_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "staff_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technician_registration_attachments_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "staff_registration_attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_registration_bank: {
        Row: {
          bank_account_name: string
          bank_account_number: string
          bank_name: string
          registration_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bank_account_name: string
          bank_account_number: string
          bank_name: string
          registration_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bank_account_name?: string
          bank_account_number?: string
          bank_name?: string
          registration_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_registration_bank_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: true
            referencedRelation: "staff_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_registrations: {
        Row: {
          created_at: string
          date_of_birth: string | null
          declared_role_hint: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relation: string | null
          employee_id: string
          full_name: string | null
          id: string
          invited_by: string | null
          invited_project_id: string | null
          phone: string | null
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["registration_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          declared_role_hint?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          employee_id: string
          full_name?: string | null
          id?: string
          invited_by?: string | null
          invited_project_id?: string | null
          phone?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["registration_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          declared_role_hint?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          employee_id?: string
          full_name?: string | null
          id?: string
          invited_by?: string | null
          invited_project_id?: string | null
          phone?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["registration_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_registrations_invited_project_id_fkey"
            columns: ["invited_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_counts: {
        Row: {
          catalog_item_id: string
          counted_at: string
          counted_by: string | null
          counted_qty: number
          created_at: string
          id: string
          note: string | null
          project_id: string
          system_qty: number
          unit: string
          unit_cost: number
          variance: number | null
          variance_value: number | null
        }
        Insert: {
          catalog_item_id: string
          counted_at?: string
          counted_by?: string | null
          counted_qty: number
          created_at?: string
          id?: string
          note?: string | null
          project_id: string
          system_qty: number
          unit: string
          unit_cost: number
          variance?: number | null
          variance_value?: number | null
        }
        Update: {
          catalog_item_id?: string
          counted_at?: string
          counted_by?: string | null
          counted_qty?: number
          created_at?: string
          id?: string
          note?: string | null
          project_id?: string
          system_qty?: number
          unit?: string
          unit_cost?: number
          variance?: number | null
          variance_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_issues: {
        Row: {
          catalog_item_id: string
          created_at: string
          id: string
          issued_at: string
          issued_by: string | null
          note: string | null
          project_id: string
          qty: number
          received_at: string | null
          received_by: string | null
          received_on_behalf: boolean
          receiver_worker_id: string | null
          sell_price: number | null
          total_cost: number | null
          total_sell: number | null
          unit: string
          unit_cost: number
          work_package_id: string
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          note?: string | null
          project_id: string
          qty: number
          received_at?: string | null
          received_by?: string | null
          received_on_behalf?: boolean
          receiver_worker_id?: string | null
          sell_price?: number | null
          total_cost?: number | null
          total_sell?: number | null
          unit: string
          unit_cost: number
          work_package_id: string
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          note?: string | null
          project_id?: string
          qty?: number
          received_at?: string | null
          received_by?: string | null
          received_on_behalf?: boolean
          receiver_worker_id?: string | null
          sell_price?: number | null
          total_cost?: number | null
          total_sell?: number | null
          unit?: string
          unit_cost?: number
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_issues_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issues_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issues_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issues_receiver_worker_id_fkey"
            columns: ["receiver_worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issues_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_on_hand: {
        Row: {
          catalog_item_id: string
          project_id: string
          qty_on_hand: number
          total_value: number
          updated_at: string
        }
        Insert: {
          catalog_item_id: string
          project_id: string
          qty_on_hand?: number
          total_value?: number
          updated_at?: string
        }
        Update: {
          catalog_item_id?: string
          project_id?: string
          qty_on_hand?: number
          total_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_on_hand_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_on_hand_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_receipts: {
        Row: {
          catalog_item_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          project_id: string
          purchase_request_id: string | null
          qty: number
          received_at: string
          supplier_id: string | null
          total_cost: number | null
          unit: string
          unit_cost: number
          vat_rate: number
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          project_id: string
          purchase_request_id?: string | null
          qty: number
          received_at?: string
          supplier_id?: string | null
          total_cost?: number | null
          unit: string
          unit_cost: number
          vat_rate?: number
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          project_id?: string
          purchase_request_id?: string | null
          qty?: number
          received_at?: string
          supplier_id?: string | null
          total_cost?: number | null
          unit?: string
          unit_cost?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_receipts_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_returns: {
        Row: {
          catalog_item_id: string
          created_at: string
          id: string
          issue_id: string
          note: string | null
          project_id: string
          qty: number
          returned_at: string
          returned_by: string | null
          total_cost: number | null
          unit: string
          unit_cost: number
          work_package_id: string
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          id?: string
          issue_id: string
          note?: string | null
          project_id: string
          qty: number
          returned_at?: string
          returned_by?: string | null
          total_cost?: number | null
          unit: string
          unit_cost: number
          work_package_id: string
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          id?: string
          issue_id?: string
          note?: string | null
          project_id?: string
          qty?: number
          returned_at?: string
          returned_by?: string | null
          total_cost?: number | null
          unit?: string
          unit_cost?: number
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_returns_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_returns_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "stock_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_returns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_returns_returned_by_fkey"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_returns_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_reversals: {
        Row: {
          catalog_item_id: string
          created_at: string
          id: string
          issue_id: string | null
          note: string | null
          project_id: string
          qty: number
          receipt_id: string | null
          reversed_at: string
          reversed_by: string | null
          value_delta: number
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          id?: string
          issue_id?: string | null
          note?: string | null
          project_id: string
          qty: number
          receipt_id?: string | null
          reversed_at?: string
          reversed_by?: string | null
          value_delta: number
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          id?: string
          issue_id?: string | null
          note?: string | null
          project_id?: string
          qty?: number
          receipt_id?: string | null
          reversed_at?: string
          reversed_by?: string | null
          value_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_reversals_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reversals_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "stock_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reversals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reversals_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "stock_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reversals_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontract_crew_attachments: {
        Row: {
          created_at: string
          crew_member_id: string
          id: string
          purpose: Database["public"]["Enums"]["crew_doc_purpose"]
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          crew_member_id: string
          id?: string
          purpose: Database["public"]["Enums"]["crew_doc_purpose"]
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          crew_member_id?: string
          id?: string
          purpose?: Database["public"]["Enums"]["crew_doc_purpose"]
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcontract_crew_attachments_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "subcontract_crew_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_crew_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontract_crew_members: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          id: string
          name: string
          national_id_number: string | null
          nationality: string | null
          phone: string | null
          subcontract_id: string
          work_permit_expiry: string | null
          work_permit_number: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          id?: string
          name: string
          national_id_number?: string | null
          nationality?: string | null
          phone?: string | null
          subcontract_id: string
          work_permit_expiry?: string | null
          work_permit_number?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          national_id_number?: string | null
          nationality?: string | null
          phone?: string | null
          subcontract_id?: string
          work_permit_expiry?: string | null
          work_permit_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subcontract_crew_members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_crew_members_subcontract_id_fkey"
            columns: ["subcontract_id"]
            isOneToOne: false
            referencedRelation: "subcontracts"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontract_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          kind: Database["public"]["Enums"]["subcontract_payment_kind"]
          method: Database["public"]["Enums"]["receipt_method"]
          note: string | null
          paid_date: string
          subcontract_id: string
          superseded_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          kind: Database["public"]["Enums"]["subcontract_payment_kind"]
          method: Database["public"]["Enums"]["receipt_method"]
          note?: string | null
          paid_date: string
          subcontract_id: string
          superseded_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          kind?: Database["public"]["Enums"]["subcontract_payment_kind"]
          method?: Database["public"]["Enums"]["receipt_method"]
          note?: string | null
          paid_date?: string
          subcontract_id?: string
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subcontract_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_payments_subcontract_id_fkey"
            columns: ["subcontract_id"]
            isOneToOne: false
            referencedRelation: "subcontracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_payments_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "subcontract_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontract_wps: {
        Row: {
          subcontract_id: string
          work_package_id: string
        }
        Insert: {
          subcontract_id: string
          work_package_id: string
        }
        Update: {
          subcontract_id?: string
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcontract_wps_subcontract_id_fkey"
            columns: ["subcontract_id"]
            isOneToOne: false
            referencedRelation: "subcontracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_wps_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontracts: {
        Row: {
          agreed_amount: number
          contractor_id: string
          created_at: string
          created_by: string
          document_path: string | null
          id: string
          note: string | null
          project_id: string
          sign_date: string | null
          status: Database["public"]["Enums"]["subcontract_status"]
          title: string
          updated_at: string
        }
        Insert: {
          agreed_amount: number
          contractor_id: string
          created_at?: string
          created_by: string
          document_path?: string | null
          id?: string
          note?: string | null
          project_id: string
          sign_date?: string | null
          status?: Database["public"]["Enums"]["subcontract_status"]
          title: string
          updated_at?: string
        }
        Update: {
          agreed_amount?: number
          contractor_id?: string
          created_at?: string
          created_by?: string
          document_path?: string | null
          id?: string
          note?: string | null
          project_id?: string
          sign_date?: string | null
          status?: Database["public"]["Enums"]["subcontract_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcontracts_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact_person: string | null
          contact_status: Database["public"]["Enums"]["contact_status"]
          created_at: string
          created_by: string
          email: string | null
          id: string
          is_vat_registered: boolean
          mailing_address: string | null
          name: string
          note: string | null
          payment_terms: string | null
          phone: string | null
          tax_id: string | null
        }
        Insert: {
          contact_person?: string | null
          contact_status?: Database["public"]["Enums"]["contact_status"]
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          is_vat_registered?: boolean
          mailing_address?: string | null
          name: string
          note?: string | null
          payment_terms?: string | null
          phone?: string | null
          tax_id?: string | null
        }
        Update: {
          contact_person?: string | null
          contact_status?: Database["public"]["Enums"]["contact_status"]
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          is_vat_registered?: boolean
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
      supply_plan_lines: {
        Row: {
          catalog_item_id: string
          created_at: string
          id: string
          note: string | null
          qty: number
          supply_plan_id: string
          work_package_id: string | null
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          id?: string
          note?: string | null
          qty: number
          supply_plan_id: string
          work_package_id?: string | null
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          id?: string
          note?: string | null
          qty?: number
          supply_plan_id?: string
          work_package_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supply_plan_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_plan_lines_supply_plan_id_fkey"
            columns: ["supply_plan_id"]
            isOneToOne: false
            referencedRelation: "supply_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_plan_lines_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_plans: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          is_template: boolean
          name: string | null
          note: string | null
          overridden_at: string | null
          overridden_by: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["supply_plan_status"]
          submitted_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_template?: boolean
          name?: string | null
          note?: string | null
          overridden_at?: string | null
          overridden_by?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["supply_plan_status"]
          submitted_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_template?: boolean
          name?: string | null
          note?: string | null
          overridden_at?: string | null
          overridden_by?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["supply_plan_status"]
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supply_plans_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_plans_overridden_by_fkey"
            columns: ["overridden_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_daily: {
        Row: {
          active: boolean
          actor_id: string
          day: string
          opens: number
          routes_touched: number
          screen_time_ms: number
          sessions: number
        }
        Insert: {
          active?: boolean
          actor_id: string
          day: string
          opens?: number
          routes_touched?: number
          screen_time_ms?: number
          sessions?: number
        }
        Update: {
          active?: boolean
          actor_id?: string
          day?: string
          opens?: number
          routes_touched?: number
          screen_time_ms?: number
          sessions?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_daily_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          department_id: string | null
          full_name: string | null
          id: string
          line_avatar_url: string | null
          line_display_name: string | null
          line_synced_at: string | null
          line_user_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          telegram_chat_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          full_name?: string | null
          id: string
          line_avatar_url?: string | null
          line_display_name?: string | null
          line_synced_at?: string | null
          line_user_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          telegram_chat_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          full_name?: string | null
          id?: string
          line_avatar_url?: string | null
          line_display_name?: string | null
          line_synced_at?: string | null
          line_user_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          telegram_chat_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      variance_snapshots: {
        Row: {
          baseline_version: number | null
          class: Database["public"]["Enums"]["variance_class"]
          created_at: string
          id: string
          project_id: string
          slip_days: number | null
          snapshot_date: string
          work_package_id: string
        }
        Insert: {
          baseline_version?: number | null
          class: Database["public"]["Enums"]["variance_class"]
          created_at?: string
          id?: string
          project_id: string
          slip_days?: number | null
          snapshot_date: string
          work_package_id: string
        }
        Update: {
          baseline_version?: number | null
          class?: Database["public"]["Enums"]["variance_class"]
          created_at?: string
          id?: string
          project_id?: string
          slip_days?: number | null
          snapshot_date?: string
          work_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variance_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variance_snapshots_work_package_id_fkey"
            columns: ["work_package_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      wage_payments: {
        Row: {
          computed_amount: number
          computed_days: number
          correction_reason: string | null
          created_at: string
          id: string
          method: Database["public"]["Enums"]["wage_payment_method"]
          note: string | null
          paid_amount: number | null
          paid_at: string
          paid_by: string
          period_from: string
          period_to: string
          reference: string | null
          superseded_by: string | null
          worker_id: string
        }
        Insert: {
          computed_amount: number
          computed_days: number
          correction_reason?: string | null
          created_at?: string
          id?: string
          method: Database["public"]["Enums"]["wage_payment_method"]
          note?: string | null
          paid_amount?: number | null
          paid_at: string
          paid_by: string
          period_from: string
          period_to: string
          reference?: string | null
          superseded_by?: string | null
          worker_id: string
        }
        Update: {
          computed_amount?: number
          computed_days?: number
          correction_reason?: string | null
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["wage_payment_method"]
          note?: string | null
          paid_amount?: number | null
          paid_at?: string
          paid_by?: string
          period_from?: string
          period_to?: string
          reference?: string | null
          superseded_by?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dc_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dc_payments_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_payments_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "wage_payments"
            referencedColumns: ["id"]
          },
        ]
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
      work_categories: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          masterformat_code: string | null
          name_en: string | null
          name_th: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          masterformat_code?: string | null
          name_en?: string | null
          name_th: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          masterformat_code?: string | null
          name_en?: string | null
          name_th?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      work_category_material_categories: {
        Row: {
          category_id: string
          created_at: string
          created_by: string | null
          id: string
          kind_filter: Database["public"]["Enums"]["catalog_item_kind"] | null
          work_category_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind_filter?: Database["public"]["Enums"]["catalog_item_kind"] | null
          work_category_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind_filter?: Database["public"]["Enums"]["catalog_item_kind"] | null
          work_category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_category_material_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "catalog_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_category_material_categories_work_category_id_fkey"
            columns: ["work_category_id"]
            isOneToOne: false
            referencedRelation: "work_categories"
            referencedColumns: ["id"]
          },
        ]
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
          category_id: string | null
          code: string
          contractor_id: string | null
          created_at: string
          deliverable_id: string | null
          description: string | null
          id: string
          is_group: boolean
          name: string
          notes: string | null
          owner_id: string | null
          parent_id: string | null
          planned_end: string | null
          planned_start: string | null
          priority: Database["public"]["Enums"]["work_package_priority"]
          project_id: string
          rework_round: number
          status: Database["public"]["Enums"]["work_package_status"]
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          code: string
          contractor_id?: string | null
          created_at?: string
          deliverable_id?: string | null
          description?: string | null
          id?: string
          is_group?: boolean
          name: string
          notes?: string | null
          owner_id?: string | null
          parent_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          priority?: Database["public"]["Enums"]["work_package_priority"]
          project_id: string
          rework_round?: number
          status?: Database["public"]["Enums"]["work_package_status"]
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          code?: string
          contractor_id?: string | null
          created_at?: string
          deliverable_id?: string | null
          description?: string | null
          id?: string
          is_group?: boolean
          name?: string
          notes?: string | null
          owner_id?: string | null
          parent_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          priority?: Database["public"]["Enums"]["work_package_priority"]
          project_id?: string
          rework_round?: number
          status?: Database["public"]["Enums"]["work_package_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_packages_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "project_categories"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "work_packages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "work_packages"
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
      worker_bank_capture: {
        Row: {
          captured_at: string
          captured_by: string
          completed_at: string | null
          completed_by: string | null
          photo_path: string
          status: Database["public"]["Enums"]["worker_bank_capture_status"]
          worker_id: string
        }
        Insert: {
          captured_at?: string
          captured_by: string
          completed_at?: string | null
          completed_by?: string | null
          photo_path: string
          status?: Database["public"]["Enums"]["worker_bank_capture_status"]
          worker_id: string
        }
        Update: {
          captured_at?: string
          captured_by?: string
          completed_at?: string | null
          completed_by?: string | null
          photo_path?: string
          status?: Database["public"]["Enums"]["worker_bank_capture_status"]
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_bank_capture_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_bank_change_requests: {
        Row: {
          bank_account_name: string | null
          bank_account_number: string | null
          bank_name: string | null
          book_bank_path: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          requested_by: string
          status: Database["public"]["Enums"]["contractor_change_status"]
          worker_id: string
        }
        Insert: {
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          book_bank_path?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          requested_by: string
          status?: Database["public"]["Enums"]["contractor_change_status"]
          worker_id: string
        }
        Update: {
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          book_bank_path?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          requested_by?: string
          status?: Database["public"]["Enums"]["contractor_change_status"]
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_bank_change_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_bank_change_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_bank_change_requests_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_invites: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          token_hash: string
          worker_id: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          token_hash: string
          worker_id: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          token_hash?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_invites_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_invites_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_level_rates: {
        Row: {
          active: boolean
          entered_rate: number | null
          level: Database["public"]["Enums"]["worker_level"]
          updated_at: string
          updated_by: string | null
          wht_basis: Database["public"]["Enums"]["wht_basis"]
        }
        Insert: {
          active?: boolean
          entered_rate?: number | null
          level: Database["public"]["Enums"]["worker_level"]
          updated_at?: string
          updated_by?: string | null
          wht_basis?: Database["public"]["Enums"]["wht_basis"]
        }
        Update: {
          active?: boolean
          entered_rate?: number | null
          level?: Database["public"]["Enums"]["worker_level"]
          updated_at?: string
          updated_by?: string | null
          wht_basis?: Database["public"]["Enums"]["wht_basis"]
        }
        Relationships: [
          {
            foreignKeyName: "worker_level_rates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
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
          bank_account_name: string | null
          bank_account_number: string | null
          bank_name: string | null
          contractor_id: string | null
          cost_confirmed_at: string | null
          cost_confirmed_by: string | null
          created_at: string
          created_by: string
          date_of_birth: string | null
          day_rate: number
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relation: string | null
          employee_id: string | null
          employment_type: Database["public"]["Enums"]["employment_type"]
          id: string
          level: Database["public"]["Enums"]["worker_level"] | null
          name: string
          note: string | null
          pay_type: Database["public"]["Enums"]["pay_type"]
          phone: string | null
          project_id: string | null
          tax_id: string | null
          user_id: string | null
        }
        Insert: {
          active?: boolean
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          contractor_id?: string | null
          cost_confirmed_at?: string | null
          cost_confirmed_by?: string | null
          created_at?: string
          created_by: string
          date_of_birth?: string | null
          day_rate?: number
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          employee_id?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          id?: string
          level?: Database["public"]["Enums"]["worker_level"] | null
          name: string
          note?: string | null
          pay_type?: Database["public"]["Enums"]["pay_type"]
          phone?: string | null
          project_id?: string | null
          tax_id?: string | null
          user_id?: string | null
        }
        Update: {
          active?: boolean
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          contractor_id?: string | null
          cost_confirmed_at?: string | null
          cost_confirmed_by?: string | null
          created_at?: string
          created_by?: string
          date_of_birth?: string | null
          day_rate?: number
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          employee_id?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          id?: string
          level?: Database["public"]["Enums"]["worker_level"] | null
          name?: string
          note?: string | null
          pay_type?: Database["public"]["Enums"]["pay_type"]
          phone?: string | null
          project_id?: string | null
          tax_id?: string | null
          user_id?: string | null
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
            foreignKeyName: "workers_cost_confirmed_by_fkey"
            columns: ["cost_confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
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
          labor_budget: number | null
          updated_at: string
          updated_by: string | null
          work_package_id: string
        }
        Insert: {
          budget?: number | null
          is_external?: boolean
          labor_budget?: number | null
          updated_at?: string
          updated_by?: string | null
          work_package_id: string
        }
        Update: {
          budget?: number | null
          is_external?: boolean
          labor_budget?: number | null
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
          quote_id: string | null
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
          quote_id?: string | null
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
          quote_id?: string | null
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
          {
            foreignKeyName: "purchase_request_attachments_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "purchase_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _integrity_check_results: {
        Args: never
        Returns: {
          domain: string
          drift: number
          implemented: boolean
          key: string
          offending_count: number
          sample: Json
          severity: string
          status: string
          title: string
          unit: string
        }[]
      }
      acknowledge_site_purchase: { Args: { p_id: string }; Returns: undefined }
      add_assembly_component: {
        Args: {
          p_assembly_id: string
          p_component_item_id: string
          p_qty_per: number
          p_waste_factor?: number
        }
        Returns: string
      }
      add_boq_line: {
        Args: {
          p_boq_template_id: string
          p_catalog_item_id?: string
          p_description: string
          p_exclusivity_group?: string
          p_is_standard?: boolean
          p_labor_rate?: number
          p_material_rate?: number
          p_qty: number
          p_unit: string
          p_variation_type?: Database["public"]["Enums"]["boq_variation_type"]
          p_work_category_id?: string
        }
        Returns: string
      }
      add_catalog_item_category: {
        Args: {
          p_category_id: string
          p_item_id: string
          p_subcategory_id?: string
        }
        Returns: string
      }
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
      add_contract_attachment: {
        Args: { p_contract_id: string; p_storage_path: string }
        Returns: string
      }
      add_contract_installment: {
        Args: {
          p_amount: number
          p_contract_id: string
          p_label: string
          p_planned_date?: string
          p_seq: number
        }
        Returns: string
      }
      add_crew_document: {
        Args: {
          p_crew_member: string
          p_purpose: Database["public"]["Enums"]["crew_doc_purpose"]
          p_storage_path: string
        }
        Returns: string
      }
      add_crew_member: {
        Args: {
          p_name: string
          p_national_id_number?: string
          p_nationality?: string
          p_phone?: string
          p_subcontract: string
          p_work_permit_expiry?: string
          p_work_permit_number?: string
        }
        Returns: string
      }
      add_daily_plan_item: {
        Args: { p_date: string; p_project: string; p_wp: string }
        Returns: string
      }
      add_feedback_attachment: {
        Args: { p_feedback_id: string; p_storage_path: string }
        Returns: string
      }
      add_purchase_order_charge: {
        Args: {
          p_amount: number
          p_charge_type: Database["public"]["Enums"]["po_charge_type"]
          p_note: string
          p_po_id: string
          p_vat_rate: number
        }
        Returns: string
      }
      add_purchase_quote: {
        Args: {
          p_note: string
          p_purchase_request_id: string
          p_supplier_id: string
          p_unit_price: number
        }
        Returns: string
      }
      add_rental_charge: {
        Args: {
          p_amount: number
          p_batch_id: string
          p_charge_type: Database["public"]["Enums"]["rental_charge_type"]
          p_note: string
          p_vat_rate: number
        }
        Returns: string
      }
      add_site_issue_attachment: {
        Args: { p_site_issue_id: string; p_storage_path: string }
        Returns: string
      }
      add_staff_registration_doc: {
        Args: {
          p_purpose: Database["public"]["Enums"]["staff_doc_purpose"]
          p_storage_path: string
        }
        Returns: string
      }
      add_supply_plan_line: {
        Args: {
          p_catalog_item_id: string
          p_note: string
          p_plan_id: string
          p_qty: number
          p_work_package_id: string
        }
        Returns: string
      }
      add_supply_plan_lines: {
        Args: { p_lines: Json; p_plan_id: string }
        Returns: number
      }
      add_work_category_material_category: {
        Args: {
          p_category_id: string
          p_kind_filter?: Database["public"]["Enums"]["catalog_item_kind"]
          p_work_category_id: string
        }
        Returns: string
      }
      add_work_package_dependency: {
        Args: { p_predecessor: string; p_successor: string }
        Returns: boolean
      }
      apply_wp_template: { Args: { p_project_id: string }; Returns: number }
      approve_crew_registration: {
        Args: {
          p_day_rate?: number
          p_employment_type?: Database["public"]["Enums"]["employment_type"]
          p_id: string
          p_pay_type?: Database["public"]["Enums"]["pay_type"]
        }
        Returns: string
      }
      approve_plan_baseline: {
        Args: { p_proposal_id: string }
        Returns: string
      }
      approve_staff_registration: {
        Args: {
          p_employment_type?: Database["public"]["Enums"]["employment_type"]
          p_id: string
          p_pay_type?: Database["public"]["Enums"]["pay_type"]
          p_project_id?: string
          p_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: string
      }
      approve_supply_plan: { Args: { p_plan_id: string }; Returns: undefined }
      assign_project_ht: {
        Args: { p_project: string; p_worker: string }
        Returns: undefined
      }
      assign_worker_to_project: {
        Args: { p_project?: string; p_reason?: string; p_worker: string }
        Returns: undefined
      }
      award_savers_bonus: { Args: { p_worker: string }; Returns: number }
      bank_name_usage: {
        Args: { p_names: string[] }
        Returns: {
          bank_name: string
          uses: number
        }[]
      }
      can_see_photo_log: { Args: { p_photo_log_id: string }; Returns: boolean }
      can_see_project: { Args: { p_project_id: string }; Returns: boolean }
      can_see_staff_registration: {
        Args: { p_registration_id: string }
        Returns: boolean
      }
      can_see_subcontract: {
        Args: { p_subcontract_id: string }
        Returns: boolean
      }
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
      claim_client_invite: { Args: { p_token: string }; Returns: undefined }
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
      claim_worker_invite: { Args: { p_token: string }; Returns: string }
      claw_back_project_coins: {
        Args: { p_note?: string; p_project: string }
        Returns: {
          clawed_total: number
          clawed_workers: number
        }[]
      }
      client_has_full_access: { Args: { p_project: string }; Returns: boolean }
      client_has_live_access: { Args: { p_project: string }; Returns: boolean }
      clone_work_packages: {
        Args: { p_dst_project_id: string; p_src_project_id: string }
        Returns: number
      }
      close_muster_day: {
        Args: { p_date: string; p_project: string }
        Returns: undefined
      }
      coin_balance: { Args: { p_worker: string }; Returns: number }
      coin_spendable_balance: { Args: { p_worker: string }; Returns: number }
      coin_unvested_balance: { Args: { p_worker: string }; Returns: number }
      coin_vested_balance: { Args: { p_worker: string }; Returns: number }
      complete_worker_bank: {
        Args: {
          p_account_name: string
          p_account_number: string
          p_bank_name: string
          p_worker_id: string
        }
        Returns: undefined
      }
      confirm_stock_issue: { Args: { p_issue_id: string }; Returns: undefined }
      confirm_stock_issue_on_behalf: {
        Args: { p_issue_id: string }
        Returns: undefined
      }
      confirm_worker_cost: {
        Args: {
          p_level: Database["public"]["Enums"]["worker_level"]
          p_worker: string
        }
        Returns: undefined
      }
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
      create_boq_template: {
        Args: { p_code: string; p_description?: string; p_name: string }
        Returns: string
      }
      create_catalog_category: {
        Args: { p_code: string; p_name: string; p_sort_order?: number }
        Returns: string
      }
      create_catalog_item: {
        Args: {
          p_base_item?: string
          p_category?: Database["public"]["Enums"]["item_category"]
          p_category_id?: string
          p_fulfillment_mode?: Database["public"]["Enums"]["catalog_fulfillment_mode"]
          p_kind?: Database["public"]["Enums"]["catalog_item_kind"]
          p_lead_time_days?: number
          p_note?: string
          p_owner_supplied?: boolean
          p_product_code?: string
          p_search_terms?: string
          p_spec_attrs?: string
          p_stockable?: boolean
          p_subcategory_id?: string
          p_unit?: string
        }
        Returns: string
      }
      create_catalog_subcategory: {
        Args: {
          p_category?: Database["public"]["Enums"]["item_category"]
          p_category_id?: string
          p_code?: string
          p_name?: string
          p_sort_order?: number
        }
        Returns: string
      }
      create_catalog_unit: {
        Args: {
          p_abbr_short?: string
          p_code: string
          p_display_name: string
          p_sort_order?: number
          p_unit_class?: Database["public"]["Enums"]["unit_class"]
        }
        Returns: undefined
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
      create_client_invite: {
        Args: {
          p_project: string
          p_tier?: Database["public"]["Enums"]["client_access_tier"]
          p_valid_until: string
        }
        Returns: string
      }
      create_client_po: {
        Args: {
          p_amount: number
          p_document_path?: string
          p_note?: string
          p_po_date: string
          p_po_no: string
          p_project_id: string
          p_quotation_id?: string
        }
        Returns: string
      }
      create_contract: {
        Args: {
          p_agreed_amount?: number
          p_contract_type: Database["public"]["Enums"]["contract_type"]
          p_counterparty_name: string
          p_counterparty_type: Database["public"]["Enums"]["contract_counterparty_type"]
          p_project_id?: string
          p_title: string
        }
        Returns: string
      }
      create_contractor_invite: {
        Args: { p_contractor_id: string }
        Returns: string
      }
      create_crew: {
        Args: {
          p_default_day_rate?: number
          p_kind?: string
          p_lead_worker?: string
          p_name: string
          p_project: string
        }
        Returns: string
      }
      create_deliverable: {
        Args: { p_code: string; p_name: string; p_project_id: string }
        Returns: string
      }
      create_department: {
        Args: {
          p_key: string
          p_name_en: string
          p_name_th: string
          p_sort_order?: number
        }
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
          p_deposit_amount?: number
          p_deposit_paid_date?: string
          p_ends_on?: string
          p_min_rental_days?: number
          p_monthly_rate: number
          p_note?: string
          p_rate_period?: Database["public"]["Enums"]["equipment_rate_period"]
          p_starts_on: string
          p_supplier_id: string
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
      create_project_category: {
        Args: {
          p_code: string
          p_name: string
          p_project_id: string
          p_sort_order: number
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
      create_quotation: {
        Args: {
          p_amount: number
          p_document_path?: string
          p_note?: string
          p_project_id: string
          p_quotation_no: string
          p_quote_date: string
        }
        Returns: string
      }
      create_subcontract: {
        Args: {
          p_agreed_amount: number
          p_contractor: string
          p_document_path?: string
          p_note?: string
          p_project: string
          p_sign_date?: string
          p_title: string
        }
        Returns: string
      }
      create_supply_plan: { Args: { p_project_id: string }; Returns: string }
      create_work_category: {
        Args: {
          p_code: string
          p_masterformat_code?: string
          p_name_en?: string
          p_name_th: string
          p_sort_order?: number
        }
        Returns: undefined
      }
      create_work_package: {
        Args: {
          p_code: string
          p_description?: string
          p_name: string
          p_parent_id?: string
          p_project_id: string
        }
        Returns: string
      }
      create_worker: {
        Args: {
          p_bank_account_name?: string
          p_bank_account_number?: string
          p_bank_name?: string
          p_contractor?: string
          p_day_rate?: number
          p_employment_type: Database["public"]["Enums"]["employment_type"]
          p_name: string
          p_note?: string
          p_pay_type: Database["public"]["Enums"]["pay_type"]
          p_phone?: string
          p_tax_id?: string
          p_user?: string
        }
        Returns: string
      }
      create_worker_invite: { Args: { p_worker: string }; Returns: string }
      crew_lead_add_member: {
        Args: {
          p_crew: string
          p_dob: string
          p_name: string
          p_national_id: string
          p_phone: string
        }
        Returns: string
      }
      current_user_contractor_id: { Args: never; Returns: string }
      current_user_led_crew_ids: { Args: never; Returns: string[] }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_user_sa_visible_crew_ids: { Args: never; Returns: string[] }
      current_user_worker_id: { Args: never; Returns: string }
      daily_work_plan_assert_writer: {
        Args: { p_project: string }
        Returns: undefined
      }
      dashboard_portfolio_spend: {
        Args: { p_project_ids: string[] }
        Returns: Json
      }
      deactivate_company_card: { Args: { p_id: string }; Returns: undefined }
      decide_contractor_bank_change: {
        Args: { p_approve: boolean; p_id: string }
        Returns: undefined
      }
      decide_identity_change: {
        Args: { p_approve: boolean; p_id: string }
        Returns: undefined
      }
      decide_staff_bank_change: {
        Args: { p_approve: boolean; p_id: string }
        Returns: undefined
      }
      decide_worker_bank_change: {
        Args: { p_approve: boolean; p_id: string }
        Returns: undefined
      }
      delete_deliverable: {
        Args: { p_deliverable_id: string }
        Returns: boolean
      }
      delete_supply_plan: { Args: { p_plan_id: string }; Returns: undefined }
      delete_work_package: {
        Args: { p_work_package_id: string }
        Returns: boolean
      }
      discard_feedback_draft: {
        Args: { p_draft_id: string }
        Returns: undefined
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
      divert_purchase_to_store: {
        Args: { p_request_id: string }
        Returns: string
      }
      draft_feedback_message: {
        Args: { p_body: string; p_feedback_id: string }
        Returns: string
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
      explode_assembly: {
        Args: { p_assembly_id: string; p_qty?: number }
        Returns: {
          component_item_id: string
          effective_qty: number
          qty_per: number
          waste_factor: number
        }[]
      }
      feedback_unread_ids: { Args: never; Returns: string[] }
      freeze_wp_labor_cost: { Args: { p_wp: string }; Returns: undefined }
      generate_purchase_requests_from_plan: {
        Args: { p_line_ids: string[]; p_plan_id: string }
        Returns: number
      }
      get_actor_timeline: {
        Args: { p_actor_id: string; p_days?: number }
        Returns: {
          duration_ms: number
          friction: Json
          last_seen_at: string
          screens: Json
          session_id: string
          started_at: string
        }[]
      }
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
      get_my_wage_payments: {
        Args: never
        Returns: {
          computed_amount: number
          computed_days: number
          correction_reason: string | null
          created_at: string
          id: string
          method: Database["public"]["Enums"]["wage_payment_method"]
          note: string | null
          paid_amount: number | null
          paid_at: string
          paid_by: string
          period_from: string
          period_to: string
          reference: string | null
          superseded_by: string | null
          worker_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "wage_payments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_my_worker_profile: {
        Args: never
        Returns: {
          bank_account_name: string
          bank_account_number: string
          bank_name: string
          date_of_birth: string
          email: string
          emergency_contact_name: string
          emergency_contact_phone: string
          emergency_contact_relation: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          name: string
          phone: string
          tax_id: string
        }[]
      }
      get_own_staff_bank: {
        Args: never
        Returns: {
          bank_account_name: string
          bank_account_number: string
          bank_name: string
        }[]
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
      grant_client_access: {
        Args: { p_project: string; p_user_id: string; p_valid_until: string }
        Returns: undefined
      }
      import_wp_grouping: {
        Args: { p_project_id: string; p_rows: Json }
        Returns: Json
      }
      integrity_scan: { Args: never; Returns: string }
      invoke_notification_drain: { Args: never; Returns: undefined }
      is_back_office: {
        Args: { p_role: Database["public"]["Enums"]["user_role"] }
        Returns: boolean
      }
      is_manager: {
        Args: { p_role: Database["public"]["Enums"]["user_role"] }
        Returns: boolean
      }
      is_site_staff: {
        Args: { p_role: Database["public"]["Enums"]["user_role"] }
        Returns: boolean
      }
      is_valid_thai_national_id: { Args: { p_id: string }; Returns: boolean }
      issue_stock: {
        Args: {
          p_catalog_item_id: string
          p_note?: string
          p_project_id: string
          p_qty: number
          p_receiver_worker_id?: string
          p_work_package_id: string
        }
        Returns: string
      }
      issue_stock_bulk: {
        Args: { p_lines: Json; p_project_id: string; p_work_package_id: string }
        Returns: number
      }
      item_price_history: {
        Args: { p_catalog_item_id: string }
        Returns: {
          net_unit_price: number
          purchased_at: string
          quantity: number
          supplier_name: string
        }[]
      }
      level_gross_rate: {
        Args: { p_level: Database["public"]["Enums"]["worker_level"] }
        Returns: number
      }
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
      mark_client_billing_invoiced: { Args: { p_id: string }; Returns: string }
      mark_expense_reimbursed: {
        Args: { p_expense_id: string }
        Returns: undefined
      }
      mark_feedback_viewed: {
        Args: { p_feedback_id: string }
        Returns: undefined
      }
      mark_retention_due: {
        Args: { p_due_date: string; p_id: string }
        Returns: string
      }
      move_muster_worker: {
        Args: { p_date: string; p_to_team: string; p_worker: string }
        Returns: string
      }
      muster_scan_in: {
        Args: {
          p_method: Database["public"]["Enums"]["muster_method"]
          p_team: string
          p_worker: string
        }
        Returns: string
      }
      muster_scan_out: {
        Args: {
          p_method: Database["public"]["Enums"]["muster_method"]
          p_team: string
          p_worker: string
        }
        Returns: string
      }
      my_contact_bank_present: { Args: never; Returns: boolean }
      open_accounting_period: { Args: { p_month: string }; Returns: string }
      open_muster_team: {
        Args: { p_date: string; p_lead_worker: string; p_project: string }
        Returns: string
      }
      photo_markup_tombstone_target_ok: {
        Args: { p_photo_log_id: string; p_superseded_by: string }
        Returns: boolean
      }
      photo_wp_deletable: { Args: { p_wp: string }; Returns: boolean }
      post_client_billing_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_client_receipt_to_gl: {
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
      post_feedback_message: {
        Args: { p_body: string; p_feedback_id: string }
        Returns: string
      }
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
      post_purchase_order_charge_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_purchase_to_gl: { Args: { p_source_id: string }; Returns: string }
      post_rental_batch_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_rental_charge_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_rental_deposit_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_rental_settlement_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_retention_release_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_stock_count_to_gl: { Args: { p_source_id: string }; Returns: string }
      post_stock_issue_to_gl: { Args: { p_source_id: string }; Returns: string }
      post_stock_receipt_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_stock_return_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_stock_reversal_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_subcontract_payment_to_gl: {
        Args: { p_source_id: string }
        Returns: string
      }
      post_wage_payment_to_gl: {
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
      project_site_management: {
        Args: { p_project: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      propose_plan_baseline: {
        Args: {
          p_kind: Database["public"]["Enums"]["plan_baseline_kind"]
          p_project_id: string
          p_reason?: string
          p_scoring_go_live?: string
          p_work_package_ids?: string[]
        }
        Returns: string
      }
      prune_gl_posting_outbox: {
        Args: { p_max_age_days?: number }
        Returns: number
      }
      prune_interaction_events: {
        Args: { p_max_age_days?: number }
        Returns: number
      }
      prune_notification_outbox: {
        Args: { p_max_age_days?: number }
        Returns: number
      }
      publish_feedback_draft: { Args: { p_draft_id: string }; Returns: string }
      purchase_report: {
        Args: {
          p_bucket: string
          p_from: string
          p_group_by: string
          p_project_id?: string
          p_to: string
        }
        Returns: {
          bucket: string
          charge_gross: number
          gross: number
          group_key: string
          group_label: string
          line_gross: number
          net: number
          pr_count: number
          vat: number
        }[]
      }
      reap_stale_reports: {
        Args: { p_max_age_minutes?: number }
        Returns: number
      }
      reassign_crew_lead: {
        Args: { p_crew: string; p_new_lead: string }
        Returns: undefined
      }
      receive_po_lines: {
        Args: {
          p_delivery_note?: string
          p_received_by?: string
          p_request_ids: string[]
        }
        Returns: number
      }
      recompute_billing_receipt_status: {
        Args: { p_billing_id: string }
        Returns: undefined
      }
      record_client_receipt: {
        Args: {
          p_amount: number
          p_billing_id?: string
          p_method: Database["public"]["Enums"]["receipt_method"]
          p_note?: string
          p_project_id: string
          p_received_date: string
        }
        Returns: string
      }
      record_contractor_consent: {
        Args: {
          p_contractor: string
          p_document_id?: string
          p_kind: Database["public"]["Enums"]["contractor_consent_kind"]
        }
        Returns: string
      }
      record_office_expense: {
        Args: {
          p_amount: number
          p_category_id: string
          p_company_card_id?: string
          p_description: string
          p_expense_date: string
          p_payment_source: Database["public"]["Enums"]["payment_source"]
          p_project_id?: string
        }
        Returns: string
      }
      record_own_staff_bank: {
        Args: {
          p_account_name: string
          p_account_number: string
          p_bank_name: string
        }
        Returns: undefined
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
      record_rental_settlement: {
        Args: {
          p_agreement_id: string
          p_base: number
          p_deposit_forfeited: number
          p_deposit_refunded: number
          p_fees: number
          p_invoice_date: string
          p_invoice_no: string
          p_method: Database["public"]["Enums"]["receipt_method"]
          p_note?: string
          p_overtime: number
          p_vat: number
        }
        Returns: string
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
          p_reason_code: Database["public"]["Enums"]["purchase_request_reason_code"]
          p_unit: string
          p_vat_rate?: number
          p_work_package_id: string
        }
        Returns: string
      }
      record_staff_consent: {
        Args: { p_kind?: Database["public"]["Enums"]["staff_consent_kind"] }
        Returns: string
      }
      record_stock_count: {
        Args: {
          p_catalog_item_id: string
          p_counted_qty: number
          p_note?: string
          p_project_id: string
        }
        Returns: string
      }
      record_stock_in: {
        Args: {
          p_catalog_item_id: string
          p_note?: string
          p_project_id: string
          p_qty: number
          p_supplier_id?: string
          p_unit_cost: number
        }
        Returns: string
      }
      record_stock_in_bulk: {
        Args: { p_lines: Json; p_project_id: string }
        Returns: number
      }
      record_subcontract_payment: {
        Args: {
          p_amount: number
          p_kind: Database["public"]["Enums"]["subcontract_payment_kind"]
          p_method: Database["public"]["Enums"]["receipt_method"]
          p_note?: string
          p_paid_date: string
          p_subcontract: string
        }
        Returns: string
      }
      record_wage_payment: {
        Args: {
          p_from: string
          p_method: Database["public"]["Enums"]["wage_payment_method"]
          p_note: string
          p_paid_amount: number
          p_paid_at: string
          p_reference: string
          p_to: string
          p_worker: string
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
      record_worker_consent: {
        Args: {
          p_document_id?: string
          p_kind: Database["public"]["Enums"]["contractor_consent_kind"]
        }
        Returns: string
      }
      redeem_shop_item: {
        Args: { p_item: string; p_worker: string }
        Returns: string
      }
      refresh_usage_daily: { Args: { p_day?: string }; Returns: number }
      reject_crew_registration: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reject_staff_registration: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reject_supply_plan: { Args: { p_plan_id: string }; Returns: undefined }
      release_retention: { Args: { p_id: string }; Returns: string }
      remove_assembly_component: { Args: { p_id: string }; Returns: undefined }
      remove_boq_line: { Args: { p_id: string }; Returns: undefined }
      remove_catalog_item_category: {
        Args: {
          p_category_id: string
          p_item_id: string
          p_subcategory_id?: string
        }
        Returns: undefined
      }
      remove_contract_installment: {
        Args: { p_id: string }
        Returns: undefined
      }
      remove_daily_plan_item: { Args: { p_item: string }; Returns: undefined }
      remove_purchase_quote: {
        Args: { p_quote_id: string }
        Returns: undefined
      }
      remove_supply_plan_line: {
        Args: { p_line_id: string }
        Returns: undefined
      }
      remove_work_category_material_category: {
        Args: {
          p_category_id: string
          p_kind_filter?: Database["public"]["Enums"]["catalog_item_kind"]
          p_work_category_id: string
        }
        Returns: undefined
      }
      remove_work_package_dependency: {
        Args: { p_predecessor: string; p_successor: string }
        Returns: boolean
      }
      reopen_supply_plan: { Args: { p_plan_id: string }; Returns: undefined }
      reopen_work_package_for_defect: {
        Args: {
          p_reason: string
          p_source?: Database["public"]["Enums"]["rework_source"]
          p_wp: string
        }
        Returns: boolean
      }
      reorder_daily_plan_items: {
        Args: { p_item_ids: string[]; p_plan: string }
        Returns: undefined
      }
      reorder_project_categories: {
        Args: { p_ids: string[]; p_project_id: string }
        Returns: undefined
      }
      report_site_issue: {
        Args: {
          p_issue_type?: Database["public"]["Enums"]["site_issue_type"]
          p_note?: string
          p_project_id: string
          p_work_package_id?: string
        }
        Returns: string
      }
      resolve_posting_period: { Args: { p_date: string }; Returns: string }
      resolve_site_issue: { Args: { p_site_issue_id: string }; Returns: string }
      return_stock_to_store: {
        Args: { p_issue_id: string; p_note?: string; p_qty: number }
        Returns: string
      }
      reverse_journal_entry: {
        Args: { p_entry_id: string; p_memo?: string }
        Returns: string
      }
      reverse_journal_internal: {
        Args: { p_entry_id: string; p_memo?: string; p_posted_by: string }
        Returns: string
      }
      reverse_stock_issue: {
        Args: { p_issue_id: string; p_note?: string }
        Returns: string
      }
      reverse_stock_receipt: {
        Args: { p_note?: string; p_receipt_id: string }
        Returns: string
      }
      revoke_client_access: {
        Args: { p_access_id: string }
        Returns: undefined
      }
      revoke_contractor_consent: { Args: { p_id: string }; Returns: undefined }
      run_and_record_integrity: { Args: never; Returns: string }
      run_integrity_checks: {
        Args: never
        Returns: {
          domain: string
          drift: number
          implemented: boolean
          key: string
          offending_count: number
          sample: Json
          severity: string
          status: string
          title: string
          unit: string
        }[]
      }
      sa_add_project_worker: {
        Args: {
          p_dob: string
          p_name: string
          p_national_id: string
          p_project: string
        }
        Returns: string
      }
      sa_add_project_worker_with_bank: {
        Args: {
          p_dob: string
          p_name: string
          p_national_id: string
          p_photo_path: string
          p_project: string
        }
        Returns: string
      }
      sa_worker_bank_status: {
        Args: { p_project: string }
        Returns: {
          status: Database["public"]["Enums"]["worker_bank_capture_status"]
          worker_id: string
        }[]
      }
      set_accounting_period_status: {
        Args: {
          p_month: string
          p_status: Database["public"]["Enums"]["accounting_period_status"]
        }
        Returns: boolean
      }
      set_boq_template_active: {
        Args: { p_id: string; p_is_active: boolean }
        Returns: undefined
      }
      set_catalog_item_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_catalog_item_image: {
        Args: { p_id: string; p_image_path: string }
        Returns: undefined
      }
      set_catalog_unit_active: {
        Args: { p_code: string; p_is_active: boolean }
        Returns: undefined
      }
      set_client_access_tier: {
        Args: {
          p_access_id: string
          p_tier: Database["public"]["Enums"]["client_access_tier"]
        }
        Returns: undefined
      }
      set_client_billing_installment: {
        Args: { p_billing_id: string; p_installment_id: string }
        Returns: string
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
      set_daily_plan_item_crew: {
        Args: { p_item: string; p_lead: string; p_worker_ids: string[] }
        Returns: undefined
      }
      set_daily_plan_item_note: {
        Args: { p_item: string; p_note: string }
        Returns: undefined
      }
      set_deliverable_name: {
        Args: { p_deliverable_id: string; p_name: string }
        Returns: boolean
      }
      set_department_head: {
        Args: { p_department: string; p_head_user: string }
        Returns: undefined
      }
      set_equipment_daily_rate: {
        Args: { p_id: string; p_rate: number }
        Returns: undefined
      }
      set_feedback_status: {
        Args: {
          p_id: string
          p_status: Database["public"]["Enums"]["feedback_status"]
        }
        Returns: undefined
      }
      set_item_sell_rate: {
        Args: { p_catalog_item_id: string; p_sell_rate: number }
        Returns: undefined
      }
      set_labor_wht_pct: { Args: { p_pct: number }; Returns: undefined }
      set_level_rate: {
        Args: {
          p_basis: Database["public"]["Enums"]["wht_basis"]
          p_entered_rate: number
          p_level: Database["public"]["Enums"]["worker_level"]
        }
        Returns: undefined
      }
      set_muster_team_wps: {
        Args: { p_team: string; p_wp_ids: string[] }
        Returns: undefined
      }
      set_nova_dial: {
        Args: { p_key: string; p_value: number }
        Returns: undefined
      }
      set_primary_project: { Args: { p_project: string }; Returns: undefined }
      set_primary_project_for: {
        Args: { p_project: string; p_user: string }
        Returns: undefined
      }
      set_project_category_active: {
        Args: { p_id: string; p_is_active: boolean }
        Returns: undefined
      }
      set_project_category_work_category: {
        Args: { p_project_category_id: string; p_work_category_id: string }
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
      set_subcontract_wps: {
        Args: { p_subcontract: string; p_wp_ids: string[] }
        Returns: undefined
      }
      set_user_department: {
        Args: { p_department: string; p_user: string }
        Returns: undefined
      }
      set_user_role: {
        Args: {
          p_role: Database["public"]["Enums"]["user_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      set_work_category_active: {
        Args: { p_code: string; p_is_active: boolean }
        Returns: undefined
      }
      set_work_package_category: {
        Args: { p_category_id: string; p_work_package_id: string }
        Returns: boolean
      }
      set_work_package_contractor: {
        Args: { p_contractor_id?: string; p_work_package_id: string }
        Returns: boolean
      }
      set_work_package_deliverable: {
        Args: { p_deliverable_id?: string; p_work_package_id: string }
        Returns: boolean
      }
      set_work_package_hold: {
        Args: { p_hold: boolean; p_wp: string }
        Returns: string
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
      set_wp_labor_budget: {
        Args: { p_budget: number; p_wp: string }
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
      site_purchase_use_now: {
        Args: {
          p_catalog_item_id: string
          p_note?: string
          p_project_id: string
          p_qty: number
          p_unit_cost: number
          p_vat_rate?: number
          p_work_package_id: string
        }
        Returns: string
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
      start_staff_registration: {
        Args: {
          p_declared_role_hint?: string
          p_full_name: string
          p_invited_by?: string
          p_invited_project_id?: string
          p_phone: string
        }
        Returns: string
      }
      store_pnl: {
        Args: { p_project_id: string }
        Returns: {
          catalog_item_id: string
          cost_total: number
          margin: number
          qty_issued: number
          sell_total: number
          shrinkage_value: number
        }[]
      }
      submit_contractor_bank_change: {
        Args: {
          p_bank_account_name: string
          p_bank_account_no: string
          p_bank_book_path: string
          p_bank_name: string
        }
        Returns: string
      }
      submit_document_decision: {
        Args: {
          p_comment: string
          p_contract_id: string
          p_decision: Database["public"]["Enums"]["document_decision"]
        }
        Returns: string
      }
      submit_feedback: {
        Args: {
          p_app_version?: string
          p_body: string
          p_page_path?: string
          p_screen?: string
          p_title: string
          p_type: Database["public"]["Enums"]["feedback_type"]
          p_user_agent?: string
        }
        Returns: string
      }
      submit_identity_change: {
        Args: { p_dob: string; p_full_name: string; p_national_id: string }
        Returns: string
      }
      submit_staff_bank_change: {
        Args: {
          p_bank_account_name: string
          p_bank_account_number: string
          p_bank_name: string
          p_book_bank_path: string
        }
        Returns: string
      }
      submit_supply_plan: { Args: { p_plan_id: string }; Returns: undefined }
      submit_worker_bank_change: {
        Args: {
          p_bank_account_name: string
          p_bank_account_number: string
          p_bank_name: string
          p_book_bank_path: string
        }
        Returns: string
      }
      suggest_project_code: { Args: never; Returns: string }
      supersede_client_receipt: {
        Args: {
          p_amount: number
          p_billing_id: string
          p_method: Database["public"]["Enums"]["receipt_method"]
          p_note: string
          p_receipt_id: string
          p_received_date: string
        }
        Returns: string
      }
      supersede_rental_settlement: {
        Args: {
          p_base: number
          p_correction_reason: string
          p_deposit_forfeited: number
          p_deposit_refunded: number
          p_fees: number
          p_invoice_date: string
          p_invoice_no: string
          p_method: Database["public"]["Enums"]["receipt_method"]
          p_note?: string
          p_overtime: number
          p_settlement_id: string
          p_vat: number
        }
        Returns: string
      }
      supersede_subcontract_payment: {
        Args: {
          p_amount: number
          p_kind: Database["public"]["Enums"]["subcontract_payment_kind"]
          p_method: Database["public"]["Enums"]["receipt_method"]
          p_note?: string
          p_paid_date: string
          p_payment_id: string
        }
        Returns: string
      }
      supply_plan_accuracy: {
        Args: { p_project_id: string }
        Returns: {
          fair_reactive: number
          planned_lines: number
          planned_qty: number
          unplanned_miss: number
          untagged: number
          work_package_id: string
          wp_code: string
          wp_name: string
        }[]
      }
      swap_deliverable_order: {
        Args: { p_a: string; p_b: string }
        Returns: boolean
      }
      update_assembly_component: {
        Args: { p_id: string; p_qty_per: number; p_waste_factor?: number }
        Returns: undefined
      }
      update_boq_line: {
        Args: {
          p_catalog_item_id?: string
          p_description: string
          p_exclusivity_group?: string
          p_id: string
          p_is_standard?: boolean
          p_labor_rate?: number
          p_material_rate?: number
          p_qty: number
          p_unit: string
          p_variation_type?: Database["public"]["Enums"]["boq_variation_type"]
          p_work_category_id?: string
        }
        Returns: undefined
      }
      update_boq_template: {
        Args: { p_description?: string; p_id: string; p_name: string }
        Returns: undefined
      }
      update_catalog_category: {
        Args: {
          p_code: string
          p_id: string
          p_is_active: boolean
          p_name: string
          p_sort_order: number
        }
        Returns: undefined
      }
      update_catalog_item: {
        Args: {
          p_base_item?: string
          p_category?: Database["public"]["Enums"]["item_category"]
          p_category_id?: string
          p_fulfillment_mode?: Database["public"]["Enums"]["catalog_fulfillment_mode"]
          p_id: string
          p_kind?: Database["public"]["Enums"]["catalog_item_kind"]
          p_lead_time_days?: number
          p_note?: string
          p_owner_supplied?: boolean
          p_product_code?: string
          p_search_terms?: string
          p_spec_attrs?: string
          p_stockable?: boolean
          p_subcategory_id?: string
          p_unit?: string
        }
        Returns: undefined
      }
      update_catalog_subcategory: {
        Args: {
          p_id: string
          p_is_active: boolean
          p_name: string
          p_sort_order: number
        }
        Returns: undefined
      }
      update_catalog_unit: {
        Args: {
          p_abbr_short?: string
          p_code: string
          p_display_name: string
          p_sort_order?: number
          p_unit_class?: Database["public"]["Enums"]["unit_class"]
        }
        Returns: undefined
      }
      update_client_po: {
        Args: {
          p_amount?: number
          p_document_path?: string
          p_id: string
          p_note?: string
          p_po_date?: string
          p_po_no?: string
          p_quotation_id?: string
        }
        Returns: string
      }
      update_contract: {
        Args: {
          p_agreed_amount?: number
          p_counterparty_name?: string
          p_document_path?: string
          p_effective_date?: string
          p_expiry_date?: string
          p_id: string
          p_project_id?: string
          p_sign_date?: string
          p_status?: Database["public"]["Enums"]["contract_status"]
          p_title?: string
        }
        Returns: undefined
      }
      update_contract_installment: {
        Args: {
          p_amount: number
          p_id: string
          p_label: string
          p_planned_date: string
          p_seq: number
        }
        Returns: string
      }
      update_crew_member: {
        Args: {
          p_active?: boolean
          p_id: string
          p_name?: string
          p_national_id_number?: string
          p_nationality?: string
          p_phone?: string
          p_work_permit_expiry?: string
          p_work_permit_number?: string
        }
        Returns: undefined
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
      update_own_staff_contact: {
        Args: {
          p_emergency_contact_name?: string
          p_emergency_contact_phone?: string
          p_emergency_contact_relation?: string
          p_phone?: string
        }
        Returns: undefined
      }
      update_own_staff_registration: {
        Args: {
          p_date_of_birth?: string
          p_declared_role_hint?: string
          p_emergency_contact_name?: string
          p_emergency_contact_phone?: string
          p_emergency_contact_relation?: string
          p_full_name?: string
          p_phone?: string
        }
        Returns: undefined
      }
      update_own_worker_profile: {
        Args: {
          p_email?: string
          p_emergency_name?: string
          p_emergency_phone?: string
          p_emergency_relation?: string
          p_phone?: string
        }
        Returns: undefined
      }
      update_project_category: {
        Args: { p_id: string; p_name: string; p_sort_order: number }
        Returns: undefined
      }
      update_project_settings: {
        Args: {
          p_budget_amount_thb?: number
          p_gmap_url?: string
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
      update_quotation: {
        Args: {
          p_amount?: number
          p_document_path?: string
          p_id: string
          p_note?: string
          p_quotation_no?: string
          p_quote_date?: string
          p_status?: Database["public"]["Enums"]["quotation_status"]
        }
        Returns: string
      }
      update_subcontract: {
        Args: {
          p_agreed_amount?: number
          p_document_path?: string
          p_id: string
          p_note?: string
          p_sign_date?: string
          p_status?: Database["public"]["Enums"]["subcontract_status"]
          p_title?: string
        }
        Returns: undefined
      }
      update_work_category: {
        Args: {
          p_code: string
          p_masterformat_code?: string
          p_name_en?: string
          p_name_th: string
          p_sort_order?: number
        }
        Returns: undefined
      }
      update_worker: {
        Args: {
          p_active?: boolean
          p_bank_account_name?: string
          p_bank_account_number?: string
          p_bank_name?: string
          p_contractor?: string
          p_employment_type?: Database["public"]["Enums"]["employment_type"]
          p_id: string
          p_name?: string
          p_note?: string
          p_pay_type?: Database["public"]["Enums"]["pay_type"]
          p_phone?: string
          p_tax_id?: string
        }
        Returns: undefined
      }
      upsert_company_card: {
        Args: {
          p_holder_user_id: string
          p_id: string
          p_label: string
          p_last4?: string
        }
        Returns: string
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
      upsert_project_contract: {
        Args: {
          p_client_po_id?: string
          p_contract_no?: string
          p_contract_value: number
          p_document_path?: string
          p_end_date?: string
          p_note?: string
          p_project_id: string
          p_quotation_id?: string
          p_retention_rate?: number
          p_sign_date?: string
          p_start_date?: string
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
      void_contract: { Args: { p_id: string }; Returns: undefined }
      void_equipment_rental_batch: {
        Args: { p_batch_id: string; p_reason?: string }
        Returns: undefined
      }
      void_purchase_order: { Args: { p_po_id: string }; Returns: undefined }
      void_purchase_order_charge: {
        Args: { p_charge_id: string }
        Returns: undefined
      }
      void_rental_charge: { Args: { p_charge_id: string }; Returns: undefined }
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
        | "quotation_create"
        | "quotation_update"
        | "client_po_create"
        | "client_po_update"
        | "project_contract_upsert"
        | "contract_installment_add"
        | "contract_installment_update"
        | "contract_installment_remove"
        | "client_billing_installment_set"
        | "client_receipt_record"
        | "client_receipt_supersede"
        | "client_billing_invoiced"
        | "purchase_order_void"
        | "subcontract_create"
        | "subcontract_update"
        | "subcontract_wps_set"
        | "subcontract_payment_record"
        | "subcontract_payment_supersede"
        | "subcontract_crew_member_add"
        | "subcontract_crew_member_update"
        | "subcontract_crew_document_add"
        | "po_charge_add"
        | "po_charge_void"
        | "rental_charge_add"
        | "rental_charge_void"
        | "rental_settlement_record"
        | "rental_settlement_supersede"
        | "crew_change"
        | "office_expense_record"
        | "office_expense_reimburse"
        | "equipment_batch_void"
      boq_line_status: "draft" | "frozen" | "superseded"
      boq_variation_type: "standard" | "added" | "omitted" | "provisional_sum"
      catalog_fulfillment_mode: "off_shelf" | "made_to_order"
      catalog_item_kind:
        | "material"
        | "tool"
        | "equipment"
        | "labor"
        | "service"
        | "softcost"
        | "assembly"
      client_access_tier: "basic" | "full"
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
      contract_counterparty_type: "client" | "contractor" | "supplier" | "other"
      contract_status: "draft" | "active" | "expired" | "terminated" | "void"
      contract_type:
        | "client_agreement"
        | "subcontract"
        | "supply"
        | "nda"
        | "other"
      contractor_category: "contractor" | "dc"
      contractor_change_status: "pending" | "approved" | "rejected"
      contractor_consent_kind: "pdpa_data" | "background_check"
      contractor_subtype:
        | "regular"
        | "dc_company"
        | "dc_regular"
        | "dc_temporary"
      crew_doc_purpose: "id_card" | "work_permit"
      crew_registration_status: "pending" | "approved" | "rejected"
      day_fraction: "full" | "half"
      document_decision: "approve" | "reject" | "needs_revision"
      document_target_type: "contract"
      employment_type: "permanent" | "temporary"
      equipment_movement_kind:
        | "received"
        | "deployed"
        | "returned"
        | "maintenance"
        | "lost"
      equipment_rate_period: "monthly" | "daily"
      equipment_status:
        | "available"
        | "on_site"
        | "in_use"
        | "maintenance"
        | "returned"
        | "lost"
      equipment_tracking: "unit" | "bulk"
      feedback_author_kind: "reporter" | "operator" | "agent"
      feedback_status: "open" | "in_progress" | "done" | "declined"
      feedback_type: "bug" | "feature"
      gl_account_type: "asset" | "liability" | "equity" | "income" | "expense"
      gl_posting_status: "pending" | "posting" | "posted" | "failed" | "skipped"
      interaction_event_type:
        | "session_start"
        | "heartbeat"
        | "session_end"
        | "route_view"
        | "feature_touch"
        | "rage_tap"
        | "form_abandon"
        | "validation_error"
        | "upload_fail"
        | "js_error"
      item_category:
        | "steel_fixing"
        | "plumbing_sanitary"
        | "site_safety"
        | "roofing"
        | "ceiling_tile"
        | "electrical"
        | "door_fire"
        | "paint"
        | "masonry_tools"
        | "machinery_tools"
        | "paving"
        | "tank_septic"
        | "custom_fabrication"
      journal_entry_status: "draft" | "posted" | "reversed"
      login_handoff_status: "pending" | "approved" | "consumed"
      muster_method: "qr" | "manual"
      notification_event_type:
        | "wp_pending_approval"
        | "wp_decision"
        | "pr_created"
        | "pr_decision"
        | "pr_progress"
        | "pr_cancelled"
        | "feedback_submitted"
        | "wp_reopened"
        | "site_issue_reported"
      notification_status: "pending" | "sending" | "sent" | "failed" | "expired"
      office_expense_doc_purpose: "payment_slip" | "tax_invoice"
      pay_type: "monthly" | "daily"
      payment_source: "company_card" | "own_money" | "company_direct"
      peak_doc_type: "contact" | "expense"
      peak_entity_type: "contact" | "expense"
      peak_sync_operation: "create" | "void"
      peak_sync_status: "pending" | "sending" | "sent" | "failed" | "skipped"
      photo_phase: "before" | "during" | "after" | "after_fix" | "defect"
      plan_baseline_kind: "initial" | "rebaseline" | "scope_change"
      po_charge_type: "transport" | "discount" | "other"
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
        | "quote"
        | "payment"
      purchase_request_priority: "normal" | "urgent" | "critical"
      purchase_request_reason_code:
        | "unplanned_miss"
        | "rework"
        | "breakage"
        | "scope_change"
        | "unforeseeable"
      purchase_request_status:
        | "requested"
        | "approved"
        | "rejected"
        | "cancelled"
        | "purchased"
        | "on_route"
        | "delivered"
        | "site_purchased"
      quotation_status: "draft" | "sent" | "accepted" | "rejected"
      receipt_method: "bank_transfer" | "cheque" | "cash"
      registration_status: "pending" | "approved" | "rejected"
      rental_agreement_status: "active" | "returned" | "settled" | "cancelled"
      rental_charge_type:
        | "delivery"
        | "pickup"
        | "cleaning"
        | "insurance"
        | "other"
      report_status: "requested" | "processing" | "complete" | "failed"
      retention_status: "held" | "due" | "released" | "forfeited"
      rework_source: "internal" | "client"
      service_subtype: "transport"
      site_issue_status: "open" | "resolved"
      site_issue_type: "weather" | "equipment" | "safety" | "access" | "other"
      staff_consent_kind: "pdpa_data"
      staff_doc_purpose: "id_card" | "profile_photo" | "book_bank"
      subcontract_payment_kind: "advance" | "progress" | "final"
      subcontract_status: "active" | "completed" | "cancelled"
      supply_plan_status: "draft" | "submitted" | "approved" | "rejected"
      unit_class: "count" | "length" | "area" | "volume" | "weight" | "trips"
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
        | "client"
        | "procurement_manager"
        | "site_owner"
        | "auditor"
        | "legal"
      variance_class:
        | "unplanned"
        | "no_evidence"
        | "completed"
        | "completed_undated"
        | "never_started_past_end"
        | "late_start"
        | "late"
        | "at_risk"
        | "on_track"
      wage_payment_method: "bank_transfer" | "cash" | "cheque"
      wht_basis: "before_wht" | "after_wht"
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
      worker_bank_capture_status: "pending_pm" | "on_file"
      worker_level: "senior" | "mid" | "junior" | "apprentice"
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
        "quotation_create",
        "quotation_update",
        "client_po_create",
        "client_po_update",
        "project_contract_upsert",
        "contract_installment_add",
        "contract_installment_update",
        "contract_installment_remove",
        "client_billing_installment_set",
        "client_receipt_record",
        "client_receipt_supersede",
        "client_billing_invoiced",
        "purchase_order_void",
        "subcontract_create",
        "subcontract_update",
        "subcontract_wps_set",
        "subcontract_payment_record",
        "subcontract_payment_supersede",
        "subcontract_crew_member_add",
        "subcontract_crew_member_update",
        "subcontract_crew_document_add",
        "po_charge_add",
        "po_charge_void",
        "rental_charge_add",
        "rental_charge_void",
        "rental_settlement_record",
        "rental_settlement_supersede",
        "crew_change",
        "office_expense_record",
        "office_expense_reimburse",
        "equipment_batch_void",
      ],
      boq_line_status: ["draft", "frozen", "superseded"],
      boq_variation_type: ["standard", "added", "omitted", "provisional_sum"],
      catalog_fulfillment_mode: ["off_shelf", "made_to_order"],
      catalog_item_kind: [
        "material",
        "tool",
        "equipment",
        "labor",
        "service",
        "softcost",
        "assembly",
      ],
      client_access_tier: ["basic", "full"],
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
      contract_counterparty_type: ["client", "contractor", "supplier", "other"],
      contract_status: ["draft", "active", "expired", "terminated", "void"],
      contract_type: [
        "client_agreement",
        "subcontract",
        "supply",
        "nda",
        "other",
      ],
      contractor_category: ["contractor", "dc"],
      contractor_change_status: ["pending", "approved", "rejected"],
      contractor_consent_kind: ["pdpa_data", "background_check"],
      contractor_subtype: [
        "regular",
        "dc_company",
        "dc_regular",
        "dc_temporary",
      ],
      crew_doc_purpose: ["id_card", "work_permit"],
      crew_registration_status: ["pending", "approved", "rejected"],
      day_fraction: ["full", "half"],
      document_decision: ["approve", "reject", "needs_revision"],
      document_target_type: ["contract"],
      employment_type: ["permanent", "temporary"],
      equipment_movement_kind: [
        "received",
        "deployed",
        "returned",
        "maintenance",
        "lost",
      ],
      equipment_rate_period: ["monthly", "daily"],
      equipment_status: [
        "available",
        "on_site",
        "in_use",
        "maintenance",
        "returned",
        "lost",
      ],
      equipment_tracking: ["unit", "bulk"],
      feedback_author_kind: ["reporter", "operator", "agent"],
      feedback_status: ["open", "in_progress", "done", "declined"],
      feedback_type: ["bug", "feature"],
      gl_account_type: ["asset", "liability", "equity", "income", "expense"],
      gl_posting_status: ["pending", "posting", "posted", "failed", "skipped"],
      interaction_event_type: [
        "session_start",
        "heartbeat",
        "session_end",
        "route_view",
        "feature_touch",
        "rage_tap",
        "form_abandon",
        "validation_error",
        "upload_fail",
        "js_error",
      ],
      item_category: [
        "steel_fixing",
        "plumbing_sanitary",
        "site_safety",
        "roofing",
        "ceiling_tile",
        "electrical",
        "door_fire",
        "paint",
        "masonry_tools",
        "machinery_tools",
        "paving",
        "tank_septic",
        "custom_fabrication",
      ],
      journal_entry_status: ["draft", "posted", "reversed"],
      login_handoff_status: ["pending", "approved", "consumed"],
      muster_method: ["qr", "manual"],
      notification_event_type: [
        "wp_pending_approval",
        "wp_decision",
        "pr_created",
        "pr_decision",
        "pr_progress",
        "pr_cancelled",
        "feedback_submitted",
        "wp_reopened",
        "site_issue_reported",
      ],
      notification_status: ["pending", "sending", "sent", "failed", "expired"],
      office_expense_doc_purpose: ["payment_slip", "tax_invoice"],
      pay_type: ["monthly", "daily"],
      payment_source: ["company_card", "own_money", "company_direct"],
      peak_doc_type: ["contact", "expense"],
      peak_entity_type: ["contact", "expense"],
      peak_sync_operation: ["create", "void"],
      peak_sync_status: ["pending", "sending", "sent", "failed", "skipped"],
      photo_phase: ["before", "during", "after", "after_fix", "defect"],
      plan_baseline_kind: ["initial", "rebaseline", "scope_change"],
      po_charge_type: ["transport", "discount", "other"],
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
        "quote",
        "payment",
      ],
      purchase_request_priority: ["normal", "urgent", "critical"],
      purchase_request_reason_code: [
        "unplanned_miss",
        "rework",
        "breakage",
        "scope_change",
        "unforeseeable",
      ],
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
      quotation_status: ["draft", "sent", "accepted", "rejected"],
      receipt_method: ["bank_transfer", "cheque", "cash"],
      registration_status: ["pending", "approved", "rejected"],
      rental_agreement_status: ["active", "returned", "settled", "cancelled"],
      rental_charge_type: [
        "delivery",
        "pickup",
        "cleaning",
        "insurance",
        "other",
      ],
      report_status: ["requested", "processing", "complete", "failed"],
      retention_status: ["held", "due", "released", "forfeited"],
      rework_source: ["internal", "client"],
      service_subtype: ["transport"],
      site_issue_status: ["open", "resolved"],
      site_issue_type: ["weather", "equipment", "safety", "access", "other"],
      staff_consent_kind: ["pdpa_data"],
      staff_doc_purpose: ["id_card", "profile_photo", "book_bank"],
      subcontract_payment_kind: ["advance", "progress", "final"],
      subcontract_status: ["active", "completed", "cancelled"],
      supply_plan_status: ["draft", "submitted", "approved", "rejected"],
      unit_class: ["count", "length", "area", "volume", "weight", "trips"],
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
        "client",
        "procurement_manager",
        "site_owner",
        "auditor",
        "legal",
      ],
      variance_class: [
        "unplanned",
        "no_evidence",
        "completed",
        "completed_undated",
        "never_started_past_end",
        "late_start",
        "late",
        "at_risk",
        "on_track",
      ],
      wage_payment_method: ["bank_transfer", "cash", "cheque"],
      wht_basis: ["before_wht", "after_wht"],
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
      worker_bank_capture_status: ["pending_pm", "on_file"],
      worker_level: ["senior", "mid", "junior", "apprentice"],
    },
  },
} as const
