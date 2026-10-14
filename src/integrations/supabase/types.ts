export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      academic_periods: {
        Row: {
          academic_year: string | null
          created_at: string
          ends_on: string
          id: string
          name: string
          position: number
          starts_on: string
          updated_at: string
        }
        Insert: {
          academic_year?: string | null
          created_at?: string
          ends_on: string
          id?: string
          name: string
          position?: number
          starts_on: string
          updated_at?: string
        }
        Update: {
          academic_year?: string | null
          created_at?: string
          ends_on?: string
          id?: string
          name?: string
          position?: number
          starts_on?: string
          updated_at?: string
        }
        Relationships: []
      }
      applications: {
        Row: {
          consent_at: string
          created_at: string
          date_of_birth: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          email: string | null
          first_name: string
          guardian_name: string | null
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          last_name: string
          locale: string
          message: string | null
          phone: string | null
          preferred_group_id: string | null
          preferred_schedule: string | null
          program_id: string | null
          program_name: string
          registration_id: string | null
          school_level_id: string | null
          school_name: string | null
          source_hash: string | null
          status: string
          student_id: string | null
          updated_at: string
        }
        Insert: {
          consent_at: string
          created_at?: string
          date_of_birth: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          email?: string | null
          first_name: string
          guardian_name?: string | null
          guardian_phone?: string | null
          guardian_relation?: string | null
          id?: string
          last_name: string
          locale?: string
          message?: string | null
          phone?: string | null
          preferred_group_id?: string | null
          preferred_schedule?: string | null
          program_id?: string | null
          program_name: string
          registration_id?: string | null
          school_level_id?: string | null
          school_name?: string | null
          source_hash?: string | null
          status?: string
          student_id?: string | null
          updated_at?: string
        }
        Update: {
          consent_at?: string
          created_at?: string
          date_of_birth?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          email?: string | null
          first_name?: string
          guardian_name?: string | null
          guardian_phone?: string | null
          guardian_relation?: string | null
          id?: string
          last_name?: string
          locale?: string
          message?: string | null
          phone?: string | null
          preferred_group_id?: string | null
          preferred_schedule?: string | null
          program_id?: string | null
          program_name?: string
          registration_id?: string | null
          school_level_id?: string | null
          school_name?: string | null
          source_hash?: string | null
          status?: string
          student_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_preferred_group_id_fkey"
            columns: ["preferred_group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "applications_preferred_group_id_fkey"
            columns: ["preferred_group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_school_level_id_fkey"
            columns: ["school_level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_scores: {
        Row: {
          absent: boolean
          assessment_id: string
          comment: string | null
          score: number | null
          student_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          absent?: boolean
          assessment_id: string
          comment?: string | null
          score?: number | null
          student_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          absent?: boolean
          assessment_id?: string
          comment?: string | null
          score?: number | null
          student_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_scores_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_scores_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_scores_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          coefficient: number
          created_at: string
          created_by: string | null
          group_id: string
          held_on: string
          id: string
          kind: string
          max_score: number
          published: boolean
          title: string
          updated_at: string
        }
        Insert: {
          coefficient?: number
          created_at?: string
          created_by?: string | null
          group_id: string
          held_on: string
          id?: string
          kind?: string
          max_score?: number
          published?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          coefficient?: number
          created_at?: string
          created_by?: string | null
          group_id?: string
          held_on?: string
          id?: string
          kind?: string
          max_score?: number
          published?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "assessments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          created_at: string
          group_id: string
          id: string
          marked_by: string | null
          session_date: string
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          marked_by?: string | null
          session_date?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          marked_by?: string | null
          session_date?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "attendance_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_email: string | null
          actor_id: string | null
          created_at: string
          details: Json
          id: string
          target_email: string | null
          target_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_email?: string | null
          target_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_email?: string | null
          target_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      center_settings: {
        Row: {
          about_ar: string | null
          about_en: string | null
          about_fr: string | null
          academic_year: string
          address: string | null
          brand_gold: string | null
          brand_gold_soft: string | null
          default_language: string
          favicon_url: string | null
          guardian_required_under_age: number
          id: boolean
          legal_name: string | null
          logo_dark_url: string | null
          logo_url: string | null
          nif: string | null
          nis: string | null
          phone: string | null
          primary_color: string | null
          rc: string | null
          school_name: string
          tagline: string | null
          tax_article: string | null
          updated_at: string
        }
        Insert: {
          about_ar?: string | null
          about_en?: string | null
          about_fr?: string | null
          academic_year?: string
          address?: string | null
          brand_gold?: string | null
          brand_gold_soft?: string | null
          default_language?: string
          favicon_url?: string | null
          guardian_required_under_age?: number
          id?: boolean
          legal_name?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          nif?: string | null
          nis?: string | null
          phone?: string | null
          primary_color?: string | null
          rc?: string | null
          school_name?: string
          tagline?: string | null
          tax_article?: string | null
          updated_at?: string
        }
        Update: {
          about_ar?: string | null
          about_en?: string | null
          about_fr?: string | null
          academic_year?: string
          address?: string | null
          brand_gold?: string | null
          brand_gold_soft?: string | null
          default_language?: string
          favicon_url?: string | null
          guardian_required_under_age?: number
          id?: boolean
          legal_name?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          nif?: string | null
          nis?: string | null
          phone?: string | null
          primary_color?: string | null
          rc?: string | null
          school_name?: string
          tagline?: string | null
          tax_article?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chapters: {
        Row: {
          completed_on: string | null
          created_at: string
          created_by: string | null
          description: string | null
          group_id: string
          id: string
          is_published: boolean
          pinned: boolean
          position: number
          published_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          completed_on?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          group_id: string
          id?: string
          is_published?: boolean
          pinned?: boolean
          position?: number
          published_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          completed_on?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          group_id?: string
          id?: string
          is_published?: boolean
          pinned?: boolean
          position?: number
          published_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chapters_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "chapters_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      charge_discounts: {
        Row: {
          amount_dzd: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          charge_id: string
          discount_id: string | null
          granted_at: string
          granted_by: string | null
          id: string
          label: string
          reason: string | null
          status: string
        }
        Insert: {
          amount_dzd: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          charge_id: string
          discount_id?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          label: string
          reason?: string | null
          status?: string
        }
        Update: {
          amount_dzd?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          charge_id?: string
          discount_id?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          label?: string
          reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "charge_discounts_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_discounts_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_discounts_discount_id_fkey"
            columns: ["discount_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_discounts_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      charge_installments: {
        Row: {
          amount_dzd: number
          charge_id: string
          created_at: string
          due_on: string
          id: string
          position: number
        }
        Insert: {
          amount_dzd: number
          charge_id: string
          created_at?: string
          due_on: string
          id?: string
          position: number
        }
        Update: {
          amount_dzd?: number
          charge_id?: string
          created_at?: string
          due_on?: string
          id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "charge_installments_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
        ]
      }
      charges: {
        Row: {
          amount_dzd: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          fee_type: string
          id: string
          label: string | null
          note: string | null
          registration_id: string
          status: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          amount_dzd: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          fee_type: string
          id?: string
          label?: string | null
          note?: string | null
          registration_id: string
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_dzd?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          fee_type?: string
          id?: string
          label?: string | null
          note?: string | null
          registration_id?: string
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "charges_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_fee_type_fkey"
            columns: ["fee_type"]
            isOneToOne: false
            referencedRelation: "fee_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "charges_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "fee_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          joined_at: string
          last_read_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          last_read_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          last_read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_message_at: string
          subject: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string
          subject?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      discounts: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          fee_type: string | null
          id: string
          kind: string
          name: string
          status: string
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          fee_type?: string | null
          id?: string
          kind: string
          name: string
          status?: string
          updated_at?: string
          value: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          fee_type?: string | null
          id?: string
          kind?: string
          name?: string
          status?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "discounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discounts_fee_type_fkey"
            columns: ["fee_type"]
            isOneToOne: false
            referencedRelation: "fee_types"
            referencedColumns: ["code"]
          },
        ]
      }
      document_sequences: {
        Row: {
          kind: string
          last_value: number
          year: number
        }
        Insert: {
          kind: string
          last_value?: number
          year: number
        }
        Update: {
          kind?: string
          last_value?: number
          year?: number
        }
        Relationships: []
      }
      employee_availability: {
        Row: {
          created_at: string
          effective_from: string | null
          effective_until: string | null
          employee_id: string
          end_time: string
          id: string
          note: string | null
          start_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          effective_from?: string | null
          effective_until?: string | null
          employee_id: string
          end_time: string
          id?: string
          note?: string | null
          start_time: string
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          effective_from?: string | null
          effective_until?: string | null
          employee_id?: string
          end_time?: string
          id?: string
          note?: string | null
          start_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_availability_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_contracts: {
        Row: {
          contract_type: string
          created_at: string
          created_by: string | null
          employee_id: string
          end_date: string | null
          id: string
          notes: string | null
          start_date: string
          status: string
          updated_at: string
          working_time: string | null
        }
        Insert: {
          contract_type: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          end_date?: string | null
          id?: string
          notes?: string | null
          start_date: string
          status?: string
          updated_at?: string
          working_time?: string | null
        }
        Update: {
          contract_type?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          working_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_contracts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_documents: {
        Row: {
          category: string
          contract_id: string | null
          created_at: string
          employee_id: string
          file_name: string | null
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          title: string
          uploaded_by: string | null
        }
        Insert: {
          category: string
          contract_id?: string | null
          created_at?: string
          employee_id: string
          file_name?: string | null
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          title: string
          uploaded_by?: string | null
        }
        Update: {
          category?: string
          contract_id?: string | null
          created_at?: string
          employee_id?: string
          file_name?: string | null
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          title?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "employee_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_leaves: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          employee_id: string
          end_date: string
          id: string
          leave_type: string
          note: string | null
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          employee_id: string
          end_date: string
          id?: string
          leave_type: string
          note?: string | null
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          employee_id?: string
          end_date?: string
          id?: string
          leave_type?: string
          note?: string | null
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_leaves_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          department: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employee_code: string | null
          employment_status: string
          end_date: string | null
          id: string
          notes: string | null
          position: string | null
          profile_id: string
          staff_type: string
          start_date: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          department?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_code?: string | null
          employment_status?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          position?: string | null
          profile_id: string
          staff_type?: string
          start_date?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          department?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_code?: string | null
          employment_status?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          position?: string | null
          profile_id?: string
          staff_type?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_templates: {
        Row: {
          amount_dzd: number
          created_at: string
          created_by: string | null
          fee_type: string
          group_id: string | null
          id: string
          label: string | null
          position: number
          program_id: string | null
          schedule: Json
          status: string
          updated_at: string
        }
        Insert: {
          amount_dzd: number
          created_at?: string
          created_by?: string | null
          fee_type: string
          group_id?: string | null
          id?: string
          label?: string | null
          position?: number
          program_id?: string | null
          schedule: Json
          status?: string
          updated_at?: string
        }
        Update: {
          amount_dzd?: number
          created_at?: string
          created_by?: string | null
          fee_type?: string
          group_id?: string | null
          id?: string
          label?: string | null
          position?: number
          program_id?: string | null
          schedule?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_templates_fee_type_fkey"
            columns: ["fee_type"]
            isOneToOne: false
            referencedRelation: "fee_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fee_templates_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "fee_templates_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_templates_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_types: {
        Row: {
          built_in: boolean
          code: string
          created_at: string
          id: string
          name: string
          position: number
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          built_in?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          position?: number
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          built_in?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: []
      }
      formation_types: {
        Row: {
          built_in: boolean
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          position: number
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          built_in?: boolean
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          position?: number
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          built_in?: boolean
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          position?: number
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: []
      }
      group_schedules: {
        Row: {
          end_time: string
          group_id: string
          id: string
          room: string | null
          room_id: string | null
          start_time: string
          weekday: number
        }
        Insert: {
          end_time: string
          group_id: string
          id?: string
          room?: string | null
          room_id?: string | null
          start_time: string
          weekday: number
        }
        Update: {
          end_time?: string
          group_id?: string
          id?: string
          room?: string | null
          room_id?: string | null
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_schedules_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "group_schedules_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_schedules_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          level_id: string | null
          max_students: number
          name: string
          price_dzd: number
          program_id: string | null
          start_date: string
          status: Database["public"]["Enums"]["entity_status"]
          stream_id: string | null
          subject_id: string | null
          teacher_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          level_id?: string | null
          max_students?: number
          name: string
          price_dzd?: number
          program_id?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["entity_status"]
          stream_id?: string | null
          subject_id?: string | null
          teacher_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          level_id?: string | null
          max_students?: number
          name?: string
          price_dzd?: number
          program_id?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["entity_status"]
          stream_id?: string | null
          subject_id?: string | null
          teacher_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          balance_dzd: number
          discount_dzd: number
          discounts: Json
          group_name: string | null
          id: string
          issued_at: string
          issued_by: string | null
          issuer: Json
          lines: Json
          number: string
          paid_dzd: number
          program_name: string | null
          registration_id: string | null
          status: string
          student_id: string | null
          student_name: string | null
          total_dzd: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          balance_dzd: number
          discount_dzd?: number
          discounts?: Json
          group_name?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          issuer?: Json
          lines: Json
          number: string
          paid_dzd?: number
          program_name?: string | null
          registration_id?: string | null
          status?: string
          student_id?: string | null
          student_name?: string | null
          total_dzd: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          balance_dzd?: number
          discount_dzd?: number
          discounts?: Json
          group_name?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          issuer?: Json
          lines?: Json
          number?: string
          paid_dzd?: number
          program_name?: string | null
          registration_id?: string | null
          status?: string
          student_id?: string | null
          student_name?: string | null
          total_dzd?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_entries: {
        Row: {
          chapter_id: string | null
          created_at: string
          created_by: string | null
          group_id: string
          homework: string | null
          homework_due: string | null
          id: string
          session_date: string
          summary: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          chapter_id?: string | null
          created_at?: string
          created_by?: string | null
          group_id: string
          homework?: string | null
          homework_due?: string | null
          id?: string
          session_date: string
          summary: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          chapter_id?: string | null
          created_at?: string
          created_by?: string | null
          group_id?: string
          homework?: string | null
          homework_due?: string | null
          id?: string
          session_date?: string
          summary?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_entries_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_entries_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "lesson_entries_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_entries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      level_systems: {
        Row: {
          built_in: boolean
          code: string
          created_at: string
          description: string | null
          id: string
          kind: string
          name: string
          position: number
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          built_in?: boolean
          code: string
          created_at?: string
          description?: string | null
          id?: string
          kind: string
          name: string
          position?: number
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          built_in?: boolean
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          name?: string
          position?: number
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: []
      }
      levels: {
        Row: {
          code: string | null
          created_at: string
          id: string
          name: string
          position: number
          stage: Database["public"]["Enums"]["level_stage"] | null
          status: Database["public"]["Enums"]["entity_status"]
          system_id: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          name: string
          position?: number
          stage?: Database["public"]["Enums"]["level_stage"] | null
          status?: Database["public"]["Enums"]["entity_status"]
          system_id?: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          name?: string
          position?: number
          stage?: Database["public"]["Enums"]["level_stage"] | null
          status?: Database["public"]["Enums"]["entity_status"]
          system_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "levels_system_id_fkey"
            columns: ["system_id"]
            isOneToOne: false
            referencedRelation: "level_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      message_campaigns: {
        Row: {
          audience_id: string | null
          audience_label: string | null
          audience_type: string
          body: string
          channel: string
          created_at: string
          created_by: string | null
          id: string
          queued: number
          skipped: number
          subject: string | null
          target: string
        }
        Insert: {
          audience_id?: string | null
          audience_label?: string | null
          audience_type: string
          body: string
          channel: string
          created_at?: string
          created_by?: string | null
          id?: string
          queued?: number
          skipped?: number
          subject?: string | null
          target?: string
        }
        Update: {
          audience_id?: string | null
          audience_label?: string | null
          audience_type?: string
          body?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          queued?: number
          skipped?: number
          subject?: string | null
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string | null
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string | null
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
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      news_posts: {
        Row: {
          audience_id: string | null
          audience_label: string | null
          audience_type: string
          body: string
          category: string
          cover_path: string | null
          created_at: string
          created_by: string | null
          id: string
          pinned: boolean
          publish_at: string | null
          published_at: string | null
          status: string
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          audience_id?: string | null
          audience_label?: string | null
          audience_type?: string
          body: string
          category?: string
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          pinned?: boolean
          publish_at?: string | null
          published_at?: string | null
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          audience_id?: string | null
          audience_label?: string | null
          audience_type?: string
          body?: string
          category?: string
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          pinned?: boolean
          publish_at?: string | null
          published_at?: string | null
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "news_posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      news_recipients: {
        Row: {
          liked_at: string | null
          post_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          liked_at?: string | null
          post_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          liked_at?: string | null
          post_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "news_recipients_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "news_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "news_recipients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          deliver_at: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          params: Json
          read_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          deliver_at?: string
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          params?: Json
          read_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          deliver_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          params?: Json
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      official_documents: {
        Row: {
          id: string
          issued_at: string
          issued_by: string | null
          issuer: Json
          kind: string
          number: string
          registration_id: string | null
          snapshot: Json
          status: string
          student_id: string | null
          student_name: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          issuer?: Json
          kind: string
          number: string
          registration_id?: string | null
          snapshot?: Json
          status?: string
          student_id?: string | null
          student_name?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          issuer?: Json
          kind?: string
          number?: string
          registration_id?: string | null
          snapshot?: Json
          status?: string
          student_id?: string | null
          student_name?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "official_documents_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_messages: {
        Row: {
          address: string
          body: string
          campaign_id: string | null
          channel: string
          created_at: string
          error: string | null
          id: string
          recipient_id: string | null
          recipient_name: string | null
          source: string
          status: string
          status_at: string | null
          status_by: string | null
          subject: string | null
        }
        Insert: {
          address: string
          body: string
          campaign_id?: string | null
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          recipient_id?: string | null
          recipient_name?: string | null
          source?: string
          status?: string
          status_at?: string | null
          status_by?: string | null
          subject?: string | null
        }
        Update: {
          address?: string
          body?: string
          campaign_id?: string | null
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          recipient_id?: string | null
          recipient_name?: string | null
          source?: string
          status?: string
          status_at?: string | null
          status_by?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outbound_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "message_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_status_by_fkey"
            columns: ["status_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_dzd: number
          created_at: string
          id: string
          method: string
          note: string | null
          paid_on: string
          recorded_by: string | null
          reference: string | null
          registration_id: string
          updated_at: string
        }
        Insert: {
          amount_dzd: number
          created_at?: string
          id?: string
          method?: string
          note?: string | null
          paid_on?: string
          recorded_by?: string | null
          reference?: string | null
          registration_id: string
          updated_at?: string
        }
        Update: {
          amount_dzd?: number
          created_at?: string
          id?: string
          method?: string
          note?: string | null
          paid_on?: string
          recorded_by?: string | null
          reference?: string | null
          registration_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          locale: string
          password_change_required: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          locale?: string
          password_change_required?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          locale?: string
          password_change_required?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      programs: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          curriculum: string | null
          description: string | null
          duration_hours: number | null
          end_date: string | null
          id: string
          level_id: string | null
          level_system_id: string | null
          name: string
          registration_open: boolean
          start_date: string | null
          status: string
          subject_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          curriculum?: string | null
          description?: string | null
          duration_hours?: number | null
          end_date?: string | null
          id?: string
          level_id?: string | null
          level_system_id?: string | null
          name: string
          registration_open?: boolean
          start_date?: string | null
          status?: string
          subject_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          curriculum?: string | null
          description?: string | null
          duration_hours?: number | null
          end_date?: string | null
          id?: string
          level_id?: string | null
          level_system_id?: string | null
          name?: string
          registration_open?: boolean
          start_date?: string | null
          status?: string
          subject_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programs_category_fkey"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "formation_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "programs_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_level_system_id_fkey"
            columns: ["level_system_id"]
            isOneToOne: false
            referencedRelation: "level_systems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          amount_dzd: number
          group_name: string | null
          id: string
          issued_at: string
          issued_by: string | null
          method: string
          number: string
          paid_on: string
          payment_id: string | null
          program_name: string | null
          reference: string | null
          registration_id: string | null
          replaced_by: string | null
          status: string
          student_id: string | null
          student_name: string | null
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount_dzd: number
          group_name?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          method: string
          number: string
          paid_on: string
          payment_id?: string | null
          program_name?: string | null
          reference?: string | null
          registration_id?: string | null
          replaced_by?: string | null
          status?: string
          student_id?: string | null
          student_name?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount_dzd?: number
          group_name?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          method?: string
          number?: string
          paid_on?: string
          payment_id?: string | null
          program_name?: string | null
          reference?: string | null
          registration_id?: string | null
          replaced_by?: string | null
          status?: string
          student_id?: string | null
          student_name?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      registrations: {
        Row: {
          created_at: string
          decided_at: string | null
          group_id: string
          id: string
          level_id: string | null
          note: string | null
          status: Database["public"]["Enums"]["registration_status"]
          student_id: string
          subject_id: string | null
          updated_at: string
          withdrawal_reason: string | null
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          group_id: string
          id?: string
          level_id?: string | null
          note?: string | null
          status?: Database["public"]["Enums"]["registration_status"]
          student_id: string
          subject_id?: string | null
          updated_at?: string
          withdrawal_reason?: string | null
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          group_id?: string
          id?: string
          level_id?: string | null
          note?: string | null
          status?: Database["public"]["Enums"]["registration_status"]
          student_id?: string
          subject_id?: string | null
          updated_at?: string
          withdrawal_reason?: string | null
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registrations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "registrations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_withdrawn_by_fkey"
            columns: ["withdrawn_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_log: {
        Row: {
          channels: string[]
          id: string
          kind: string
          params: Json
          sent_at: string
          subject_key: string
          user_id: string
        }
        Insert: {
          channels: string[]
          id?: string
          kind: string
          params?: Json
          sent_at?: string
          subject_key: string
          user_id: string
        }
        Update: {
          channels?: string[]
          id?: string
          kind?: string
          params?: Json
          sent_at?: string
          subject_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_rules: {
        Row: {
          channels: string[]
          enabled: boolean
          kind: string
          last_run_at: string | null
          threshold: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          channels?: string[]
          enabled?: boolean
          kind: string
          last_run_at?: string | null
          threshold: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          channels?: string[]
          enabled?: boolean
          kind?: string
          last_run_at?: string | null
          threshold?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_comments: {
        Row: {
          comment: string
          group_id: string | null
          id: string
          period_id: string
          student_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          comment: string
          group_id?: string | null
          id?: string
          period_id: string
          student_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          comment?: string
          group_id?: string | null
          id?: string
          period_id?: string
          student_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_comments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "report_comments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_comments_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "academic_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_comments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_comments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_events: {
        Row: {
          id: string
          kind: Database["public"]["Enums"]["resource_event_kind"]
          occurred_at: string
          resource_id: string
          student_id: string
        }
        Insert: {
          id?: string
          kind?: Database["public"]["Enums"]["resource_event_kind"]
          occurred_at?: string
          resource_id: string
          student_id: string
        }
        Update: {
          id?: string
          kind?: Database["public"]["Enums"]["resource_event_kind"]
          occurred_at?: string
          resource_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_events_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resource_engagement"
            referencedColumns: ["resource_id"]
          },
          {
            foreignKeyName: "resource_events_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resource_student_engagement"
            referencedColumns: ["resource_id"]
          },
          {
            foreignKeyName: "resource_events_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_events_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          allow_download: boolean
          chapter_id: string
          created_at: string
          created_by: string | null
          description: string | null
          file_ext: string | null
          file_name: string | null
          group_id: string
          id: string
          is_published: boolean
          kind: Database["public"]["Enums"]["resource_kind"]
          link_provider: string | null
          link_thumbnail_url: string | null
          mime_type: string | null
          pinned: boolean
          position: number
          published_at: string | null
          role: Database["public"]["Enums"]["resource_role"]
          size_bytes: number | null
          storage_path: string | null
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          allow_download?: boolean
          chapter_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_ext?: string | null
          file_name?: string | null
          group_id: string
          id?: string
          is_published?: boolean
          kind: Database["public"]["Enums"]["resource_kind"]
          link_provider?: string | null
          link_thumbnail_url?: string | null
          mime_type?: string | null
          pinned?: boolean
          position?: number
          published_at?: string | null
          role?: Database["public"]["Enums"]["resource_role"]
          size_bytes?: number | null
          storage_path?: string | null
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          allow_download?: boolean
          chapter_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_ext?: string | null
          file_name?: string | null
          group_id?: string
          id?: string
          is_published?: boolean
          kind?: Database["public"]["Enums"]["resource_kind"]
          link_provider?: string | null
          link_thumbnail_url?: string | null
          mime_type?: string | null
          pinned?: boolean
          position?: number
          published_at?: string | null
          role?: Database["public"]["Enums"]["resource_role"]
          size_bytes?: number | null
          storage_path?: string | null
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "resources_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          capacity: number | null
          created_at: string
          equipment: string | null
          id: string
          location: string | null
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          equipment?: string | null
          id?: string
          location?: string | null
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          created_at?: string
          equipment?: string | null
          id?: string
          location?: string | null
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_attendance: {
        Row: {
          check_in: string | null
          check_out: string | null
          created_at: string
          employee_id: string
          id: string
          note: string | null
          recorded_by: string | null
          status: string
          updated_at: string
          work_date: string
          worked_minutes: number | null
        }
        Insert: {
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          employee_id: string
          id?: string
          note?: string | null
          recorded_by?: string | null
          status: string
          updated_at?: string
          work_date: string
          worked_minutes?: number | null
        }
        Update: {
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          note?: string | null
          recorded_by?: string | null
          status?: string
          updated_at?: string
          work_date?: string
          worked_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      streams: {
        Row: {
          code: string
          created_at: string
          id: string
          level_id: string
          name_ar: string
          name_en: string
          name_fr: string
          position: number
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          level_id: string
          name_ar: string
          name_en: string
          name_fr: string
          position?: number
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          level_id?: string
          name_ar?: string
          name_en?: string
          name_fr?: string
          position?: number
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "streams_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
        ]
      }
      student_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          student_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_notes_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          address: string | null
          created_at: string
          date_of_birth: string | null
          gender: Database["public"]["Enums"]["gender"] | null
          guardian_name: string | null
          guardian_phone: string | null
          id: string
          level_id: string | null
          onboarded_at: string | null
          registered_at: string
          role: Database["public"]["Enums"]["app_role"] | null
          status: Database["public"]["Enums"]["entity_status"]
          stream_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          date_of_birth?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id: string
          level_id?: string | null
          onboarded_at?: string | null
          registered_at?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          status?: Database["public"]["Enums"]["entity_status"]
          stream_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          date_of_birth?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id?: string
          level_id?: string | null
          onboarded_at?: string | null
          registered_at?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          status?: Database["public"]["Enums"]["entity_status"]
          stream_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_id_role_fkey"
            columns: ["id", "role"]
            isOneToOne: false
            referencedRelation: "user_roles"
            referencedColumns: ["user_id", "role"]
          },
          {
            foreignKeyName: "students_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          color: string
          created_at: string
          description: string | null
          domain: string
          id: string
          key: string
          name: string
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          domain?: string
          id?: string
          key: string
          name: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          domain?: string
          id?: string
          key?: string
          name?: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: []
      }
      teacher_subjects: {
        Row: {
          subject_id: string
          teacher_id: string
        }
        Insert: {
          subject_id: string
          teacher_id: string
        }
        Update: {
          subject_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_subjects_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          bio: string | null
          created_at: string
          experience_years: number
          id: string
          role: Database["public"]["Enums"]["app_role"] | null
          status: Database["public"]["Enums"]["entity_status"]
          status_changed_at: string | null
          status_reason: string | null
          updated_at: string
        }
        Insert: {
          bio?: string | null
          created_at?: string
          experience_years?: number
          id: string
          role?: Database["public"]["Enums"]["app_role"] | null
          status?: Database["public"]["Enums"]["entity_status"]
          status_changed_at?: string | null
          status_reason?: string | null
          updated_at?: string
        }
        Update: {
          bio?: string | null
          created_at?: string
          experience_years?: number
          id?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          status?: Database["public"]["Enums"]["entity_status"]
          status_changed_at?: string | null
          status_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teachers_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teachers_id_role_fkey"
            columns: ["id", "role"]
            isOneToOne: false
            referencedRelation: "user_roles"
            referencedColumns: ["user_id", "role"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      attendance_monthly_stats: {
        Row: {
          absent: number | null
          excused: number | null
          group_id: string | null
          late: number | null
          month: string | null
          present: number | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "attendance_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_payment_totals: {
        Row: {
          last_paid_on: string | null
          paid_dzd: number | null
          payment_count: number | null
          registration_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_charges_monthly: {
        Row: {
          charge_count: number | null
          charged_dzd: number | null
          discounted_dzd: number | null
          fee_type: string | null
          month: string | null
          program_id: string | null
          program_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charges_fee_type_fkey"
            columns: ["fee_type"]
            isOneToOne: false
            referencedRelation: "fee_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "groups_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_payments_monthly: {
        Row: {
          method: string | null
          month: string | null
          payment_count: number | null
          program_id: string | null
          program_name: string | null
          total_dzd: number | null
        }
        Relationships: [
          {
            foreignKeyName: "groups_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      group_enrollment_counts: {
        Row: {
          enrolled_count: number | null
          group_id: string | null
        }
        Relationships: []
      }
      payment_daily_totals: {
        Row: {
          paid_on: string | null
          payment_count: number | null
          total_dzd: number | null
        }
        Relationships: []
      }
      resource_engagement: {
        Row: {
          chapter_id: string | null
          distinct_students: number | null
          downloads: number | null
          group_id: string | null
          last_downloaded_at: string | null
          last_viewed_at: string | null
          resource_id: string | null
          views: number | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "resources_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_student_engagement: {
        Row: {
          downloads: number | null
          group_id: string | null
          last_viewed_at: string | null
          opened: boolean | null
          resource_id: string | null
          student_id: string | null
          views: number | null
        }
        Relationships: [
          {
            foreignKeyName: "registrations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "resources_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      session_attendance_summary: {
        Row: {
          absent_count: number | null
          excused_count: number | null
          group_id: string | null
          last_marked_at: string | null
          late_count: number | null
          marked_count: number | null
          present_count: number | null
          session_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_enrollment_counts"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "attendance_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_application: {
        Args: { p_application: string; p_group: string; p_student: string }
        Returns: string
      }
      assert_admin_removable: {
        Args: { _action: string; _actor: string; _target: string }
        Returns: undefined
      }
      can_download_resource: {
        Args: { _resource_id: string }
        Returns: boolean
      }
      can_manage_group: { Args: { _group_id: string }; Returns: boolean }
      can_record_resource_event: {
        Args: { _resource_id: string }
        Returns: boolean
      }
      can_view_resource: { Args: { _resource_id: string }; Returns: boolean }
      cancel_charge: {
        Args: { p_charge: string; p_reason: string }
        Returns: undefined
      }
      cancel_discount: {
        Args: { p_grant: string; p_reason: string }
        Returns: undefined
      }
      center_storage_bytes: { Args: never; Returns: number }
      center_storage_quota_bytes: { Args: never; Returns: number }
      conversation_messages: {
        Args: { p_conversation: string }
        Returns: {
          body: string
          created_at: string
          id: string
          sender_avatar: string
          sender_id: string
          sender_name: string
        }[]
      }
      create_formation: {
        Args: { first_group?: Json; formation: Json }
        Returns: Json
      }
      customize_group_fees: { Args: { p_group: string }; Returns: number }
      delete_news: { Args: { p_post: string }; Returns: string }
      entity_dependencies: {
        Args: { _entity: string; _id: string }
        Returns: {
          relationship: string
          row_count: number
          severity: string
          source_table: string
        }[]
      }
      grant_discount: {
        Args: {
          p_amount: number
          p_charge: string
          p_discount: string
          p_label: string
          p_reason: string
        }
        Returns: string
      }
      is_enrolled_in_group: { Args: { _group_id: string }; Returns: boolean }
      is_safe_asset_url: { Args: { url: string }; Returns: boolean }
      issue_invoice: { Args: { p_registration: string }; Returns: string }
      issue_official_document: {
        Args: { p_kind: string; p_registration: string }
        Returns: string
      }
      mark_conversation_read: {
        Args: { p_conversation: string }
        Returns: undefined
      }
      mark_news_read: { Args: { p_post: string }; Returns: undefined }
      messaging_contacts: {
        Args: never
        Returns: {
          avatar_url: string
          context: string
          full_name: string
          role: string
          user_id: string
        }[]
      }
      my_conversations: {
        Args: { p_all?: boolean }
        Returns: {
          created_at: string
          id: string
          is_participant: boolean
          last_body: string
          last_message_at: string
          last_sender_id: string
          last_sender_name: string
          participants: Json
          subject: string
          unread: number
        }[]
      }
      news_feed: {
        Args: { p_post?: string }
        Returns: {
          audience_id: string
          audience_label: string
          audience_type: string
          author_avatar: string
          author_name: string
          body: string
          can_edit: boolean
          category: string
          cover_path: string
          created_at: string
          created_by: string
          id: string
          likes: number
          my_liked: boolean
          my_read: boolean
          pinned: boolean
          publish_at: string
          published_at: string
          recipients: number
          status: string
          summary: string
          title: string
          updated_at: string
          views: number
        }[]
      }
      preview_campaign: {
        Args: {
          p_audience_id: string
          p_audience_type: string
          p_channel: string
          p_target: string
        }
        Returns: Json
      }
      preview_reminders: {
        Args: never
        Returns: {
          already_sent: boolean
          full_name: string
          kind: string
          params: Json
          subject_key: string
          user_id: string
        }[]
      }
      provision_staff: {
        Args: {
          _bio?: string
          _experience_years?: number
          _phone?: string
          _role: Database["public"]["Enums"]["app_role"]
          _target: string
        }
        Returns: undefined
      }
      publish_news: {
        Args: { p_post: string; p_publish_at?: string }
        Returns: number
      }
      queue_campaign: {
        Args: {
          p_audience_id: string
          p_audience_type: string
          p_body: string
          p_channel: string
          p_subject: string
          p_target: string
        }
        Returns: Json
      }
      remove_fee_template: { Args: { p_id: string }; Returns: string }
      replace_group_schedules: {
        Args: { p_group: string; p_slots: Json }
        Returns: undefined
      }
      resource_role_weight: {
        Args: { _role: Database["public"]["Enums"]["resource_role"] }
        Returns: number
      }
      run_reminders: { Args: never; Returns: Json }
      save_charge: {
        Args: {
          p_amount: number
          p_charge: string
          p_fee_type: string
          p_installments: Json
          p_label: string
          p_note: string
          p_registration: string
        }
        Returns: string
      }
      save_discount: {
        Args: {
          p_description: string
          p_fee_type: string
          p_id: string
          p_kind: string
          p_name: string
          p_value: number
        }
        Returns: string
      }
      save_fee_template: {
        Args: {
          p_amount: number
          p_fee_type: string
          p_group: string
          p_id: string
          p_label: string
          p_program: string
          p_schedule: Json
        }
        Returns: string
      }
      school_level_system_id: { Args: never; Returns: string }
      send_message: {
        Args: { p_body: string; p_conversation: string }
        Returns: string
      }
      set_discount_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_outbound_status: {
        Args: { p_error?: string; p_ids: string[]; p_status: string }
        Returns: number
      }
      set_teacher_lifecycle: {
        Args: {
          _next: Database["public"]["Enums"]["entity_status"]
          _reason?: string
          _teacher: string
        }
        Returns: undefined
      }
      start_conversation: {
        Args: { p_body: string; p_recipients: string[]; p_subject: string }
        Returns: string
      }
      storage_quota_allows: { Args: { _incoming: number }; Returns: boolean }
      teacher_deletion_blockers: {
        Args: { _teacher: string }
        Returns: {
          attendance_marked: number
          audit_entries: number
          deletable: boolean
          groups_assigned: number
          notes_authored: number
        }[]
      }
      teacher_workload: {
        Args: { _teacher: string }
        Returns: {
          group_count: number
          student_count: number
          subject_count: number
          weekly_minutes: number
        }[]
      }
      toggle_news_like: { Args: { p_post: string }; Returns: boolean }
      void_invoice: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      void_official_document: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "teacher" | "student"
      attendance_status: "present" | "absent" | "late" | "excused"
      audit_action:
        | "teacher_created"
        | "teacher_updated"
        | "teacher_disabled"
        | "teacher_enabled"
        | "teacher_password_reset"
        | "role_granted"
        | "role_revoked"
        | "teacher_suspended"
        | "teacher_reactivated"
        | "teacher_archived"
        | "teacher_restored"
        | "teacher_deleted"
        | "admin_deactivated"
        | "admin_reactivated"
        | "admin_deleted"
        | "payment_recorded"
        | "payment_updated"
        | "payment_deleted"
        | "hr_created"
        | "hr_updated"
        | "hr_deleted"
        | "charge_created"
        | "charge_updated"
        | "charge_cancelled"
        | "fee_template_created"
        | "fee_template_updated"
        | "fee_template_removed"
        | "discount_created"
        | "discount_updated"
        | "discount_granted"
        | "discount_cancelled"
        | "receipt_issued"
        | "receipt_voided"
        | "invoice_issued"
        | "invoice_voided"
        | "document_issued"
        | "document_voided"
      entity_status: "active" | "inactive" | "suspended" | "archived"
      gender: "male" | "female"
      level_stage: "primary" | "middle" | "high"
      notification_kind:
        | "registration_approved"
        | "registration_rejected"
        | "attendance_marked"
        | "teacher_assigned"
        | "group_updated"
        | "announcement"
        | "resource_published"
        | "chapter_published"
        | "application_received"
        | "message_received"
        | "payment_reminder"
        | "absence_alert"
        | "lesson_log_reminder"
      registration_status: "pending" | "approved" | "rejected" | "withdrawn"
      resource_event_kind: "open" | "download" | "view"
      resource_kind: "file" | "link"
      resource_role:
        | "notes"
        | "exercises"
        | "solutions"
        | "video"
        | "homework"
        | "extra"
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
      app_role: ["admin", "teacher", "student"],
      attendance_status: ["present", "absent", "late", "excused"],
      audit_action: [
        "teacher_created",
        "teacher_updated",
        "teacher_disabled",
        "teacher_enabled",
        "teacher_password_reset",
        "role_granted",
        "role_revoked",
        "teacher_suspended",
        "teacher_reactivated",
        "teacher_archived",
        "teacher_restored",
        "teacher_deleted",
        "admin_deactivated",
        "admin_reactivated",
        "admin_deleted",
        "payment_recorded",
        "payment_updated",
        "payment_deleted",
        "hr_created",
        "hr_updated",
        "hr_deleted",
        "charge_created",
        "charge_updated",
        "charge_cancelled",
        "fee_template_created",
        "fee_template_updated",
        "fee_template_removed",
        "discount_created",
        "discount_updated",
        "discount_granted",
        "discount_cancelled",
        "receipt_issued",
        "receipt_voided",
        "invoice_issued",
        "invoice_voided",
        "document_issued",
        "document_voided",
      ],
      entity_status: ["active", "inactive", "suspended", "archived"],
      gender: ["male", "female"],
      level_stage: ["primary", "middle", "high"],
      notification_kind: [
        "registration_approved",
        "registration_rejected",
        "attendance_marked",
        "teacher_assigned",
        "group_updated",
        "announcement",
        "resource_published",
        "chapter_published",
        "application_received",
        "message_received",
        "payment_reminder",
        "absence_alert",
        "lesson_log_reminder",
      ],
      registration_status: ["pending", "approved", "rejected", "withdrawn"],
      resource_event_kind: ["open", "download", "view"],
      resource_kind: ["file", "link"],
      resource_role: [
        "notes",
        "exercises",
        "solutions",
        "video",
        "homework",
        "extra",
      ],
    },
  },
} as const
