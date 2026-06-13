export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      approvals: {
        Row: {
          comment: string | null;
          decided_at: string;
          decided_by: string;
          decision: Database["public"]["Enums"]["approval_decision"];
          id: string;
          work_package_id: string;
        };
        Insert: {
          comment?: string | null;
          decided_at?: string;
          decided_by: string;
          decision: Database["public"]["Enums"]["approval_decision"];
          id?: string;
          work_package_id: string;
        };
        Update: {
          comment?: string | null;
          decided_at?: string;
          decided_by?: string;
          decision?: Database["public"]["Enums"]["approval_decision"];
          id?: string;
          work_package_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "approvals_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approvals_work_package_id_fkey";
            columns: ["work_package_id"];
            isOneToOne: false;
            referencedRelation: "work_packages";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"];
          actor_id: string | null;
          actor_role: Database["public"]["Enums"]["user_role"] | null;
          client_ts: string | null;
          created_at: string;
          id: string;
          payload: Json | null;
          target_id: string | null;
          target_table: string | null;
        };
        Insert: {
          action: Database["public"]["Enums"]["audit_action"];
          actor_id?: string | null;
          actor_role?: Database["public"]["Enums"]["user_role"] | null;
          client_ts?: string | null;
          created_at?: string;
          id?: string;
          payload?: Json | null;
          target_id?: string | null;
          target_table?: string | null;
        };
        Update: {
          action?: Database["public"]["Enums"]["audit_action"];
          actor_id?: string | null;
          actor_role?: Database["public"]["Enums"]["user_role"] | null;
          client_ts?: string | null;
          created_at?: string;
          id?: string;
          payload?: Json | null;
          target_id?: string | null;
          target_table?: string | null;
        };
        Relationships: [];
      };
      contractors: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          phone: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          phone?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contractors_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      deliverables: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          name: string;
          project_id: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          name: string;
          project_id: string;
          sort_order: number;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          name?: string;
          project_id?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deliverables_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      labor_logs: {
        Row: {
          contractor_id_snapshot: string | null;
          correction_reason: string | null;
          created_at: string;
          day_fraction: Database["public"]["Enums"]["day_fraction"] | null;
          day_rate_snapshot: number;
          entered_by: string;
          id: string;
          self_logged: boolean;
          superseded_by: string | null;
          work_date: string;
          work_package_id: string;
          worker_id: string;
          worker_name_snapshot: string;
          worker_type_snapshot: Database["public"]["Enums"]["worker_type"];
        };
        Insert: {
          contractor_id_snapshot?: string | null;
          correction_reason?: string | null;
          created_at?: string;
          day_fraction?: Database["public"]["Enums"]["day_fraction"] | null;
          day_rate_snapshot: number;
          entered_by: string;
          id?: string;
          self_logged?: boolean;
          superseded_by?: string | null;
          work_date: string;
          work_package_id: string;
          worker_id: string;
          worker_name_snapshot: string;
          worker_type_snapshot: Database["public"]["Enums"]["worker_type"];
        };
        Update: {
          contractor_id_snapshot?: string | null;
          correction_reason?: string | null;
          created_at?: string;
          day_fraction?: Database["public"]["Enums"]["day_fraction"] | null;
          day_rate_snapshot?: number;
          entered_by?: string;
          id?: string;
          self_logged?: boolean;
          superseded_by?: string | null;
          work_date?: string;
          work_package_id?: string;
          worker_id?: string;
          worker_name_snapshot?: string;
          worker_type_snapshot?: Database["public"]["Enums"]["worker_type"];
        };
        Relationships: [
          {
            foreignKeyName: "labor_logs_entered_by_fkey";
            columns: ["entered_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "labor_logs_superseded_by_fkey";
            columns: ["superseded_by"];
            isOneToOne: false;
            referencedRelation: "labor_logs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "labor_logs_work_package_id_fkey";
            columns: ["work_package_id"];
            isOneToOne: false;
            referencedRelation: "work_packages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "labor_logs_worker_id_fkey";
            columns: ["worker_id"];
            isOneToOne: false;
            referencedRelation: "workers";
            referencedColumns: ["id"];
          },
        ];
      };
      login_handoffs: {
        Row: {
          created_at: string;
          device_code: string;
          expires_at: string;
          id: string;
          line_claims: Json;
          state: string;
          status: Database["public"]["Enums"]["login_handoff_status"];
          user_email: string | null;
        };
        Insert: {
          created_at?: string;
          device_code: string;
          expires_at: string;
          id?: string;
          line_claims?: Json;
          state: string;
          status?: Database["public"]["Enums"]["login_handoff_status"];
          user_email?: string | null;
        };
        Update: {
          created_at?: string;
          device_code?: string;
          expires_at?: string;
          id?: string;
          line_claims?: Json;
          state?: string;
          status?: Database["public"]["Enums"]["login_handoff_status"];
          user_email?: string | null;
        };
        Relationships: [];
      };
      notification_outbox: {
        Row: {
          attempts: number;
          claimed_at: string | null;
          created_at: string;
          event_type: Database["public"]["Enums"]["notification_event_type"];
          id: string;
          last_error: string | null;
          payload: Json;
          purchase_request_id: string | null;
          sent_at: string | null;
          status: Database["public"]["Enums"]["notification_status"];
          work_package_id: string | null;
        };
        Insert: {
          attempts?: number;
          claimed_at?: string | null;
          created_at?: string;
          event_type: Database["public"]["Enums"]["notification_event_type"];
          id?: string;
          last_error?: string | null;
          payload?: Json;
          purchase_request_id?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["notification_status"];
          work_package_id?: string | null;
        };
        Update: {
          attempts?: number;
          claimed_at?: string | null;
          created_at?: string;
          event_type?: Database["public"]["Enums"]["notification_event_type"];
          id?: string;
          last_error?: string | null;
          payload?: Json;
          purchase_request_id?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["notification_status"];
          work_package_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notification_outbox_purchase_request_id_fkey";
            columns: ["purchase_request_id"];
            isOneToOne: false;
            referencedRelation: "purchase_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_outbox_work_package_id_fkey";
            columns: ["work_package_id"];
            isOneToOne: false;
            referencedRelation: "work_packages";
            referencedColumns: ["id"];
          },
        ];
      };
      photo_logs: {
        Row: {
          captured_at_client: string | null;
          created_at: string;
          id: string;
          phase: Database["public"]["Enums"]["photo_phase"];
          storage_path: string | null;
          superseded_by: string | null;
          uploaded_by: string;
          work_package_id: string;
        };
        Insert: {
          captured_at_client?: string | null;
          created_at?: string;
          id?: string;
          phase: Database["public"]["Enums"]["photo_phase"];
          storage_path?: string | null;
          superseded_by?: string | null;
          uploaded_by: string;
          work_package_id: string;
        };
        Update: {
          captured_at_client?: string | null;
          created_at?: string;
          id?: string;
          phase?: Database["public"]["Enums"]["photo_phase"];
          storage_path?: string | null;
          superseded_by?: string | null;
          uploaded_by?: string;
          work_package_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "photo_logs_superseded_by_fkey";
            columns: ["superseded_by"];
            isOneToOne: false;
            referencedRelation: "photo_logs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "photo_logs_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "photo_logs_work_package_id_fkey";
            columns: ["work_package_id"];
            isOneToOne: false;
            referencedRelation: "work_packages";
            referencedColumns: ["id"];
          },
        ];
      };
      photo_markups: {
        Row: {
          comment: string | null;
          created_at: string;
          created_by: string;
          id: string;
          photo_log_id: string;
          strokes: Json | null;
          superseded_by: string | null;
        };
        Insert: {
          comment?: string | null;
          created_at?: string;
          created_by: string;
          id?: string;
          photo_log_id: string;
          strokes?: Json | null;
          superseded_by?: string | null;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          photo_log_id?: string;
          strokes?: Json | null;
          superseded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "photo_markups_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "photo_markups_photo_log_id_fkey";
            columns: ["photo_log_id"];
            isOneToOne: false;
            referencedRelation: "photo_logs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "photo_markups_supersede_fk";
            columns: ["superseded_by", "photo_log_id"];
            isOneToOne: false;
            referencedRelation: "photo_markups";
            referencedColumns: ["id", "photo_log_id"];
          },
          {
            foreignKeyName: "photo_markups_supersede_fk";
            columns: ["superseded_by", "photo_log_id"];
            isOneToOne: false;
            referencedRelation: "photo_markups_current";
            referencedColumns: ["id", "photo_log_id"];
          },
        ];
      };
      projects: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          name: string;
          status: Database["public"]["Enums"]["project_status"];
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          name: string;
          status?: Database["public"]["Enums"]["project_status"];
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          name?: string;
          status?: Database["public"]["Enums"]["project_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      purchase_request_attachment_tokens: {
        Row: {
          access_token: string;
          attachment_id: string;
          rotated_at: string | null;
        };
        Insert: {
          access_token?: string;
          attachment_id: string;
          rotated_at?: string | null;
        };
        Update: {
          access_token?: string;
          attachment_id?: string;
          rotated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_request_attachment_tokens_attachment_id_fkey";
            columns: ["attachment_id"];
            isOneToOne: true;
            referencedRelation: "purchase_request_attachments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_request_attachment_tokens_attachment_id_fkey";
            columns: ["attachment_id"];
            isOneToOne: true;
            referencedRelation: "purchase_request_attachments_appsheet";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_request_attachment_tokens_attachment_id_fkey";
            columns: ["attachment_id"];
            isOneToOne: true;
            referencedRelation: "purchase_request_attachments_current";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_request_attachments: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          kind: Database["public"]["Enums"]["purchase_request_attachment_kind"];
          purchase_request_id: string;
          purpose: Database["public"]["Enums"]["purchase_request_attachment_purpose"];
          storage_path: string | null;
          superseded_by: string | null;
          url: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          kind: Database["public"]["Enums"]["purchase_request_attachment_kind"];
          purchase_request_id: string;
          purpose?: Database["public"]["Enums"]["purchase_request_attachment_purpose"];
          storage_path?: string | null;
          superseded_by?: string | null;
          url?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["purchase_request_attachment_kind"];
          purchase_request_id?: string;
          purpose?: Database["public"]["Enums"]["purchase_request_attachment_purpose"];
          storage_path?: string | null;
          superseded_by?: string | null;
          url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pra_supersede_fk";
            columns: ["superseded_by", "purchase_request_id", "kind"];
            isOneToOne: false;
            referencedRelation: "purchase_request_attachments";
            referencedColumns: ["id", "purchase_request_id", "kind"];
          },
          {
            foreignKeyName: "pra_supersede_fk";
            columns: ["superseded_by", "purchase_request_id", "kind"];
            isOneToOne: false;
            referencedRelation: "purchase_request_attachments_appsheet";
            referencedColumns: ["id", "purchase_request_id", "kind"];
          },
          {
            foreignKeyName: "pra_supersede_fk";
            columns: ["superseded_by", "purchase_request_id", "kind"];
            isOneToOne: false;
            referencedRelation: "purchase_request_attachments_current";
            referencedColumns: ["id", "purchase_request_id", "kind"];
          },
          {
            foreignKeyName: "purchase_request_attachments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_request_attachments_purchase_request_id_fkey";
            columns: ["purchase_request_id"];
            isOneToOne: false;
            referencedRelation: "purchase_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_requests: {
        Row: {
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          amount: number | null;
          approved_by: string | null;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          created_at: string;
          decided_at: string | null;
          decision_comment: string | null;
          delivered_at: string | null;
          delivery_note: string | null;
          eta: string | null;
          id: string;
          item_description: string;
          needed_by: string | null;
          notes: string | null;
          order_ref: string | null;
          pr_number: number;
          priority: Database["public"]["Enums"]["purchase_request_priority"];
          purchased_at: string | null;
          quantity: number;
          received_by: string | null;
          requested_at: string;
          requested_by: string | null;
          requested_by_email: string | null;
          shipped_at: string | null;
          source: string;
          status: Database["public"]["Enums"]["purchase_request_status"];
          supplier: string | null;
          supplier_id: string | null;
          unit: string;
          updated_at: string;
          work_package_id: string;
        };
        Insert: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          amount?: number | null;
          approved_by?: string | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decision_comment?: string | null;
          delivered_at?: string | null;
          delivery_note?: string | null;
          eta?: string | null;
          id?: string;
          item_description: string;
          needed_by?: string | null;
          notes?: string | null;
          order_ref?: string | null;
          pr_number?: number;
          priority?: Database["public"]["Enums"]["purchase_request_priority"];
          purchased_at?: string | null;
          quantity: number;
          received_by?: string | null;
          requested_at?: string;
          requested_by?: string | null;
          requested_by_email?: string | null;
          shipped_at?: string | null;
          source?: string;
          status?: Database["public"]["Enums"]["purchase_request_status"];
          supplier?: string | null;
          supplier_id?: string | null;
          unit: string;
          updated_at?: string;
          work_package_id: string;
        };
        Update: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          amount?: number | null;
          approved_by?: string | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decision_comment?: string | null;
          delivered_at?: string | null;
          delivery_note?: string | null;
          eta?: string | null;
          id?: string;
          item_description?: string;
          needed_by?: string | null;
          notes?: string | null;
          order_ref?: string | null;
          pr_number?: number;
          priority?: Database["public"]["Enums"]["purchase_request_priority"];
          purchased_at?: string | null;
          quantity?: number;
          received_by?: string | null;
          requested_at?: string;
          requested_by?: string | null;
          requested_by_email?: string | null;
          shipped_at?: string | null;
          source?: string;
          status?: Database["public"]["Enums"]["purchase_request_status"];
          supplier?: string | null;
          supplier_id?: string | null;
          unit?: string;
          updated_at?: string;
          work_package_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_requests_acknowledged_by_fkey";
            columns: ["acknowledged_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_requests_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_requests_cancelled_by_fkey";
            columns: ["cancelled_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_requests_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_requests_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_requests_work_package_id_fkey";
            columns: ["work_package_id"];
            isOneToOne: false;
            referencedRelation: "work_packages";
            referencedColumns: ["id"];
          },
        ];
      };
      reports: {
        Row: {
          created_at: string;
          error: string | null;
          id: string;
          params: Json;
          project_id: string;
          requested_by: string;
          status: Database["public"]["Enums"]["report_status"];
          storage_path: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          error?: string | null;
          id?: string;
          params?: Json;
          project_id: string;
          requested_by: string;
          status?: Database["public"]["Enums"]["report_status"];
          storage_path?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          error?: string | null;
          id?: string;
          params?: Json;
          project_id?: string;
          requested_by?: string;
          status?: Database["public"]["Enums"]["report_status"];
          storage_path?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      suppliers: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          phone: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          phone?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "suppliers_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          created_at: string;
          full_name: string | null;
          id: string;
          line_avatar_url: string | null;
          line_user_id: string | null;
          role: Database["public"]["Enums"]["user_role"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          full_name?: string | null;
          id: string;
          line_avatar_url?: string | null;
          line_user_id?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          full_name?: string | null;
          id?: string;
          line_avatar_url?: string | null;
          line_user_id?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
      work_package_members: {
        Row: {
          added_at: string;
          added_by: string;
          user_id: string;
          work_package_id: string;
        };
        Insert: {
          added_at?: string;
          added_by: string;
          user_id: string;
          work_package_id: string;
        };
        Update: {
          added_at?: string;
          added_by?: string;
          user_id?: string;
          work_package_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_package_members_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_package_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_package_members_work_package_id_fkey";
            columns: ["work_package_id"];
            isOneToOne: false;
            referencedRelation: "work_packages";
            referencedColumns: ["id"];
          },
        ];
      };
      work_packages: {
        Row: {
          code: string;
          contractor_id: string | null;
          created_at: string;
          deliverable_id: string | null;
          description: string | null;
          id: string;
          name: string;
          owner_id: string | null;
          project_id: string;
          status: Database["public"]["Enums"]["work_package_status"];
          updated_at: string;
        };
        Insert: {
          code: string;
          contractor_id?: string | null;
          created_at?: string;
          deliverable_id?: string | null;
          description?: string | null;
          id?: string;
          name: string;
          owner_id?: string | null;
          project_id: string;
          status?: Database["public"]["Enums"]["work_package_status"];
          updated_at?: string;
        };
        Update: {
          code?: string;
          contractor_id?: string | null;
          created_at?: string;
          deliverable_id?: string | null;
          description?: string | null;
          id?: string;
          name?: string;
          owner_id?: string | null;
          project_id?: string;
          status?: Database["public"]["Enums"]["work_package_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_packages_contractor_id_fkey";
            columns: ["contractor_id"];
            isOneToOne: false;
            referencedRelation: "contractors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_packages_deliverable_id_fkey";
            columns: ["deliverable_id"];
            isOneToOne: false;
            referencedRelation: "deliverables";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_packages_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_packages_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      workers: {
        Row: {
          active: boolean;
          contractor_id: string | null;
          created_at: string;
          created_by: string;
          day_rate: number;
          id: string;
          name: string;
          user_id: string | null;
          worker_type: Database["public"]["Enums"]["worker_type"];
        };
        Insert: {
          active?: boolean;
          contractor_id?: string | null;
          created_at?: string;
          created_by: string;
          day_rate?: number;
          id?: string;
          name: string;
          user_id?: string | null;
          worker_type: Database["public"]["Enums"]["worker_type"];
        };
        Update: {
          active?: boolean;
          contractor_id?: string | null;
          created_at?: string;
          created_by?: string;
          day_rate?: number;
          id?: string;
          name?: string;
          user_id?: string | null;
          worker_type?: Database["public"]["Enums"]["worker_type"];
        };
        Relationships: [
          {
            foreignKeyName: "workers_contractor_id_fkey";
            columns: ["contractor_id"];
            isOneToOne: false;
            referencedRelation: "contractors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workers_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      wp_labor_costs: {
        Row: {
          computed_at: string;
          dc_cost: number;
          frozen_by: string;
          own_cost: number;
          work_package_id: string;
        };
        Insert: {
          computed_at?: string;
          dc_cost: number;
          frozen_by: string;
          own_cost: number;
          work_package_id: string;
        };
        Update: {
          computed_at?: string;
          dc_cost?: number;
          frozen_by?: string;
          own_cost?: number;
          work_package_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wp_labor_costs_frozen_by_fkey";
            columns: ["frozen_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wp_labor_costs_work_package_id_fkey";
            columns: ["work_package_id"];
            isOneToOne: true;
            referencedRelation: "work_packages";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      photo_markups_current: {
        Row: {
          comment: string | null;
          created_at: string | null;
          created_by: string | null;
          id: string | null;
          photo_log_id: string | null;
          strokes: Json | null;
        };
        Insert: {
          comment?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          id?: string | null;
          photo_log_id?: string | null;
          strokes?: Json | null;
        };
        Update: {
          comment?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          id?: string | null;
          photo_log_id?: string | null;
          strokes?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "photo_markups_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "photo_markups_photo_log_id_fkey";
            columns: ["photo_log_id"];
            isOneToOne: false;
            referencedRelation: "photo_logs";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_request_attachments_appsheet: {
        Row: {
          access_token: string | null;
          created_at: string | null;
          id: string | null;
          kind: Database["public"]["Enums"]["purchase_request_attachment_kind"] | null;
          purchase_request_id: string | null;
          purpose: Database["public"]["Enums"]["purchase_request_attachment_purpose"] | null;
          storage_path: string | null;
          url: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_request_attachments_purchase_request_id_fkey";
            columns: ["purchase_request_id"];
            isOneToOne: false;
            referencedRelation: "purchase_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_request_attachments_current: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          id: string | null;
          kind: Database["public"]["Enums"]["purchase_request_attachment_kind"] | null;
          purchase_request_id: string | null;
          purpose: Database["public"]["Enums"]["purchase_request_attachment_purpose"] | null;
          storage_path: string | null;
          url: string | null;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          id?: string | null;
          kind?: Database["public"]["Enums"]["purchase_request_attachment_kind"] | null;
          purchase_request_id?: string | null;
          purpose?: Database["public"]["Enums"]["purchase_request_attachment_purpose"] | null;
          storage_path?: string | null;
          url?: string | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          id?: string | null;
          kind?: Database["public"]["Enums"]["purchase_request_attachment_kind"] | null;
          purchase_request_id?: string | null;
          purpose?: Database["public"]["Enums"]["purchase_request_attachment_purpose"] | null;
          storage_path?: string | null;
          url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_request_attachments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_request_attachments_purchase_request_id_fkey";
            columns: ["purchase_request_id"];
            isOneToOne: false;
            referencedRelation: "purchase_requests";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      acknowledge_site_purchase: { Args: { p_id: string }; Returns: undefined };
      claim_next_report: {
        Args: never;
        Returns: {
          created_at: string;
          error: string | null;
          id: string;
          params: Json;
          project_id: string;
          requested_by: string;
          status: Database["public"]["Enums"]["report_status"];
          storage_path: string | null;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "reports";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      correct_labor_log: {
        Args: {
          p_fraction?: Database["public"]["Enums"]["day_fraction"];
          p_log: string;
          p_reason: string;
          p_tombstone?: boolean;
        };
        Returns: string;
      };
      create_worker: {
        Args: {
          p_contractor?: string;
          p_day_rate: number;
          p_name: string;
          p_type: Database["public"]["Enums"]["worker_type"];
          p_user?: string;
        };
        Returns: string;
      };
      current_user_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["user_role"];
      };
      freeze_wp_labor_cost: { Args: { p_wp: string }; Returns: undefined };
      invoke_notification_drain: { Args: never; Returns: undefined };
      log_labor_day: {
        Args: {
          p_date: string;
          p_fraction: Database["public"]["Enums"]["day_fraction"];
          p_worker: string;
          p_wp: string;
        };
        Returns: string;
      };
      pr_attachment_tombstone_target_ok: {
        Args: { p_caller: string; p_parent: string; p_target: string };
        Returns: boolean;
      };
      reap_stale_reports: {
        Args: { p_max_age_minutes?: number };
        Returns: number;
      };
      record_purchase: {
        Args: {
          p_amount?: number;
          p_eta?: string;
          p_order_ref?: string;
          p_purchase_request_id: string;
          p_supplier_id: string;
        };
        Returns: undefined;
      };
      record_shipment: {
        Args: { p_purchase_request_id: string };
        Returns: undefined;
      };
      record_site_purchase: {
        Args: {
          p_item_description: string;
          p_quantity: number;
          p_unit: string;
          p_work_package_id: string;
        };
        Returns: string;
      };
      set_work_package_contractor: {
        Args: { p_contractor_id?: string; p_work_package_id: string };
        Returns: boolean;
      };
      set_worker_day_rate: {
        Args: { p_id: string; p_rate: number };
        Returns: undefined;
      };
      update_my_display_name: {
        Args: { p_full_name: string };
        Returns: undefined;
      };
      update_project_settings: {
        Args: {
          p_name: string;
          p_project_id: string;
          p_status: Database["public"]["Enums"]["project_status"];
        };
        Returns: boolean;
      };
      update_worker: {
        Args: {
          p_active?: boolean;
          p_contractor?: string;
          p_id: string;
          p_name?: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      approval_decision: "approved" | "rejected" | "needs_revision";
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
        | "labor_cost_freeze";
      day_fraction: "full" | "half";
      login_handoff_status: "pending" | "approved" | "consumed";
      notification_event_type:
        | "wp_pending_approval"
        | "wp_decision"
        | "pr_created"
        | "pr_decision"
        | "pr_progress"
        | "pr_cancelled";
      notification_status: "pending" | "sending" | "sent" | "failed" | "expired";
      photo_phase: "before" | "during" | "after";
      project_status: "active" | "on_hold" | "completed" | "archived";
      purchase_request_attachment_kind: "image" | "link";
      purchase_request_attachment_purpose: "reference" | "delivery_confirmation" | "invoice";
      purchase_request_priority: "normal" | "urgent" | "critical";
      purchase_request_status:
        | "requested"
        | "approved"
        | "rejected"
        | "cancelled"
        | "purchased"
        | "on_route"
        | "delivered"
        | "site_purchased";
      report_status: "requested" | "processing" | "complete" | "failed";
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
        | "visitor";
      work_package_status:
        | "not_started"
        | "in_progress"
        | "on_hold"
        | "complete"
        | "pending_approval";
      worker_type: "own" | "dc";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
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
      ],
      day_fraction: ["full", "half"],
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
      photo_phase: ["before", "during", "after"],
      project_status: ["active", "on_hold", "completed", "archived"],
      purchase_request_attachment_kind: ["image", "link"],
      purchase_request_attachment_purpose: ["reference", "delivery_confirmation", "invoice"],
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
      ],
      work_package_status: [
        "not_started",
        "in_progress",
        "on_hold",
        "complete",
        "pending_approval",
      ],
      worker_type: ["own", "dc"],
    },
  },
} as const;
