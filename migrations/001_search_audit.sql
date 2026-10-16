CREATE TABLE IF NOT EXISTS public.search_audit (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id bigint,
  method text NOT NULL CHECK (method IN ('camera','gallery','voice','text','rack')),
  query_text varchar(200),
  status text NOT NULL CHECK (status IN ('found','not_found','error')),
  http_status integer NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  result_count integer NOT NULL CHECK (result_count >= 0),
  returned_count integer NOT NULL CHECK (returned_count >= 0),
  results jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(results) = 'array'),
  model text,
  error_code text,
  selected_item_id bigint,
  selected_rank integer,
  relevance boolean,
  reviewed_at timestamptz,
  CHECK ((relevance IS NULL) = (reviewed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS search_audit_created_idx ON public.search_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS search_audit_method_created_idx ON public.search_audit(method, created_at DESC);
ALTER TABLE public.search_audit ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.search_audit IS 'Search outcomes and explicit relevance feedback. Similarity scores and result availability are not accuracy.';
