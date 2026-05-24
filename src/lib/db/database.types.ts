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
      users: {
        Row: {
          created_at: string;
          full_name: string | null;
          id: string;
          line_user_id: string | null;
          role: Database["public"]["Enums"]["user_role"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          full_name?: string | null;
          id: string;
          line_user_id?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          full_name?: string | null;
          id?: string;
          line_user_id?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
      work_packages: {
        Row: {
          code: string;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          project_id: string;
          status: Database["public"]["Enums"]["work_package_status"];
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          project_id: string;
          status?: Database["public"]["Enums"]["work_package_status"];
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          project_id?: string;
          status?: Database["public"]["Enums"]["work_package_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_packages_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_user_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["user_role"];
      };
    };
    Enums: {
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
        | "other";
      photo_phase: "before" | "during" | "after";
      project_status: "active" | "on_hold" | "completed" | "archived";
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
      ],
      photo_phase: ["before", "during", "after"],
      project_status: ["active", "on_hold", "completed", "archived"],
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
    },
  },
} as const;
