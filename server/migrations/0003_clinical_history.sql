-- Clinical history, isolated from legacy jobs, secrets and provider schemas.

CREATE SCHEMA nina_clinic;

REVOKE ALL ON SCHEMA nina_clinic FROM PUBLIC;

CREATE TABLE nina_meta.data_imports (
  source_sha256 char(64) PRIMARY KEY,
  imported_at timestamptz NOT NULL DEFAULT now(),
  row_counts jsonb NOT NULL
);
REVOKE ALL ON nina_meta.data_imports FROM PUBLIC;

CREATE TYPE nina_clinic.appointment_type AS ENUM (
    'demo',
    'meeting',
    'support',
    'followup',
    'visitacao',
    'consultoria',
    'assinatura_contrato',
    'vistoria',
    'avaliacao'
);


CREATE TYPE nina_clinic.conversation_status AS ENUM (
    'nina',
    'human',
    'paused'
);


CREATE TYPE nina_clinic.team_assignment AS ENUM (
    'mateus',
    'igor',
    'fe',
    'vendas',
    'suporte'
);


CREATE TYPE nina_clinic.message_type AS ENUM (
    'text',
    'audio',
    'image',
    'document',
    'video'
);


CREATE TYPE nina_clinic.message_from AS ENUM (
    'user',
    'nina',
    'human'
);


CREATE TYPE nina_clinic.message_status AS ENUM (
    'sent',
    'delivered',
    'read',
    'failed',
    'processing'
);


CREATE TABLE nina_clinic.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_number text NOT NULL,
    whatsapp_id text,
    name text,
    call_name text,
    email text,
    profile_picture_url text,
    is_business boolean DEFAULT false,
    is_blocked boolean DEFAULT false,
    blocked_at timestamp with time zone,
    blocked_reason text,
    tags text[] DEFAULT '{}'::text[],
    notes text,
    client_memory jsonb DEFAULT '{"last_updated": null, "lead_profile": {"interests": [], "lead_stage": "new", "objections": [], "products_discussed": [], "communication_style": "unknown", "qualification_score": 0}, "sales_intelligence": {"pain_points": [], "next_best_action": "qualify", "budget_indication": "unknown", "decision_timeline": "unknown"}, "interaction_summary": {"response_pattern": "unknown", "last_contact_reason": "", "total_conversations": 0, "preferred_contact_time": "unknown"}, "conversation_history": []}'::jsonb,
    first_contact_date timestamp with time zone DEFAULT now() NOT NULL,
    last_activity timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    vetsoft_client_id integer,
    vetsoft_synced_at timestamp with time zone,
    vetsoft_sync_error text
);


ALTER TABLE nina_clinic.contacts ADD PRIMARY KEY (id);

CREATE TABLE nina_clinic.animals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    name text NOT NULL,
    species text,
    breed text,
    sex text,
    birth_date date,
    notes text,
    vetsoft_animal_id integer,
    vetsoft_synced_at timestamp with time zone,
    vetsoft_sync_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE nina_clinic.animals ADD PRIMARY KEY (id);

CREATE TABLE nina_clinic.procedures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    category text,
    requirements text,
    price_type text DEFAULT 'fixed'::text NOT NULL,
    price numeric,
    price_min numeric,
    price_max numeric,
    duration_minutes integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    vetsoft_item_id integer,
    vetsoft_item_type text,
    vetsoft_synced_at timestamp with time zone,
    source text DEFAULT 'manual'::text NOT NULL
);


ALTER TABLE nina_clinic.procedures ADD PRIMARY KEY (id);

CREATE TABLE nina_clinic.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    date date NOT NULL,
    "time" time without time zone NOT NULL,
    duration integer DEFAULT 60 NOT NULL,
    type nina_clinic.appointment_type DEFAULT 'meeting'::nina_clinic.appointment_type NOT NULL,
    attendees text[] DEFAULT '{}'::text[],
    contact_id uuid,
    meeting_url text,
    status text DEFAULT 'scheduled'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    user_id uuid,
    property_id uuid,
    procedure_id uuid,
    animal_id uuid,
    vetsoft_event_id integer,
    vetsoft_synced_at timestamp with time zone,
    vetsoft_sync_error text
);


ALTER TABLE nina_clinic.appointments ADD PRIMARY KEY (id);

CREATE TABLE nina_clinic.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    status nina_clinic.conversation_status DEFAULT 'nina'::nina_clinic.conversation_status NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    assigned_team nina_clinic.team_assignment,
    assigned_user_id uuid,
    tags text[] DEFAULT '{}'::text[],
    nina_context jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    ai_paused boolean DEFAULT false NOT NULL,
    ai_paused_at timestamp with time zone,
    ai_paused_reason text,
    ai_paused_by uuid,
    zernio_conversation_id text,
    archived_at timestamp with time zone,
    archived_by uuid
);


ALTER TABLE nina_clinic.conversations ADD PRIMARY KEY (id);

CREATE TABLE nina_clinic.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    reply_to_id uuid,
    whatsapp_message_id text,
    type nina_clinic.message_type DEFAULT 'text'::nina_clinic.message_type NOT NULL,
    from_type nina_clinic.message_from NOT NULL,
    content text,
    media_url text,
    media_type text,
    status nina_clinic.message_status DEFAULT 'sent'::nina_clinic.message_status NOT NULL,
    processed_by_nina boolean DEFAULT false,
    nina_response_time integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE nina_clinic.messages ADD PRIMARY KEY (id);

ALTER TABLE nina_clinic.contacts ADD UNIQUE (phone_number);
ALTER TABLE nina_clinic.contacts ADD FOREIGN KEY (user_id) REFERENCES nina_auth.users(id);
ALTER TABLE nina_clinic.animals ADD FOREIGN KEY (contact_id) REFERENCES nina_clinic.contacts(id);
ALTER TABLE nina_clinic.appointments ADD FOREIGN KEY (user_id) REFERENCES nina_auth.users(id);
ALTER TABLE nina_clinic.appointments ADD FOREIGN KEY (contact_id) REFERENCES nina_clinic.contacts(id);
ALTER TABLE nina_clinic.appointments ADD FOREIGN KEY (animal_id) REFERENCES nina_clinic.animals(id);
ALTER TABLE nina_clinic.appointments ADD FOREIGN KEY (procedure_id) REFERENCES nina_clinic.procedures(id);
ALTER TABLE nina_clinic.conversations ADD FOREIGN KEY (contact_id) REFERENCES nina_clinic.contacts(id);
ALTER TABLE nina_clinic.conversations ADD FOREIGN KEY (user_id) REFERENCES nina_auth.users(id);
ALTER TABLE nina_clinic.messages ADD FOREIGN KEY (conversation_id) REFERENCES nina_clinic.conversations(id);
ALTER TABLE nina_clinic.messages ADD FOREIGN KEY (reply_to_id) REFERENCES nina_clinic.messages(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX contacts_created_idx ON nina_clinic.contacts (created_at DESC, id);
CREATE INDEX animals_contact_idx ON nina_clinic.animals (contact_id, created_at, id);
CREATE INDEX appointments_contact_idx ON nina_clinic.appointments (contact_id, date DESC, time DESC, id);
CREATE INDEX appointments_date_idx ON nina_clinic.appointments (date, time, id);
CREATE INDEX conversations_contact_idx ON nina_clinic.conversations (contact_id, last_message_at DESC, id);
CREATE INDEX messages_conversation_idx ON nina_clinic.messages (conversation_id, created_at DESC, id);
CREATE INDEX procedures_name_idx ON nina_clinic.procedures (name, id);

-- Legacy policies share these six tables with clinic staff. Keep this clinic-wide scope,

-- requiring a live native account/role and a transaction-local identity set by the API.

ALTER TABLE nina_clinic.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON nina_clinic.contacts FOR SELECT USING (
 EXISTS (SELECT 1 FROM nina_auth.users u JOIN nina_auth.user_roles r ON r.user_id = u.id
  WHERE u.id = nullif(current_setting('nina.user_id', true), '')::uuid
    AND u.disabled_at IS NULL AND r.role IN ('admin', 'user'))
);

ALTER TABLE nina_clinic.animals ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON nina_clinic.animals FOR SELECT USING (
 EXISTS (SELECT 1 FROM nina_auth.users u JOIN nina_auth.user_roles r ON r.user_id = u.id
  WHERE u.id = nullif(current_setting('nina.user_id', true), '')::uuid
    AND u.disabled_at IS NULL AND r.role IN ('admin', 'user'))
);

ALTER TABLE nina_clinic.procedures ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON nina_clinic.procedures FOR SELECT USING (
 EXISTS (SELECT 1 FROM nina_auth.users u JOIN nina_auth.user_roles r ON r.user_id = u.id
  WHERE u.id = nullif(current_setting('nina.user_id', true), '')::uuid
    AND u.disabled_at IS NULL AND r.role IN ('admin', 'user'))
);

ALTER TABLE nina_clinic.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON nina_clinic.appointments FOR SELECT USING (
 EXISTS (SELECT 1 FROM nina_auth.users u JOIN nina_auth.user_roles r ON r.user_id = u.id
  WHERE u.id = nullif(current_setting('nina.user_id', true), '')::uuid
    AND u.disabled_at IS NULL AND r.role IN ('admin', 'user'))
);

ALTER TABLE nina_clinic.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON nina_clinic.conversations FOR SELECT USING (
 EXISTS (SELECT 1 FROM nina_auth.users u JOIN nina_auth.user_roles r ON r.user_id = u.id
  WHERE u.id = nullif(current_setting('nina.user_id', true), '')::uuid
    AND u.disabled_at IS NULL AND r.role IN ('admin', 'user'))
);

ALTER TABLE nina_clinic.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON nina_clinic.messages FOR SELECT USING (
 EXISTS (SELECT 1 FROM nina_auth.users u JOIN nina_auth.user_roles r ON r.user_id = u.id
  WHERE u.id = nullif(current_setting('nina.user_id', true), '')::uuid
    AND u.disabled_at IS NULL AND r.role IN ('admin', 'user'))
);

REVOKE ALL ON ALL TABLES IN SCHEMA nina_clinic FROM PUBLIC;
