-- Drop existing table and recreate with 1536 dimensions (Matryoshka truncated)
DROP TABLE IF EXISTS portfolio_documents CASCADE;

CREATE TABLE portfolio_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Use HNSW index for vector similarity search
CREATE INDEX portfolio_documents_embedding_idx
ON portfolio_documents USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Function for similarity search
CREATE OR REPLACE FUNCTION match_portfolio_documents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    content,
    metadata,
    1 - (embedding <=> query_embedding) as similarity
  FROM portfolio_documents
  WHERE 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY (embedding <=> query_embedding)
  LIMIT match_count;
$$;

-- Enable Row Level Security
ALTER TABLE portfolio_documents ENABLE ROW LEVEL SECURITY;

-- Create policy for read access (public for chatbot)
CREATE POLICY "Allow public read access"
ON portfolio_documents
FOR SELECT
USING (true);

-- Create policy for admin write access
CREATE POLICY "Allow admin write access"
ON portfolio_documents
FOR ALL
USING (auth.role() = 'service_role');

COMMENT ON TABLE portfolio_documents IS 'Stores portfolio information chunks with 1536-dimension vector embeddings for RAG chatbot';
COMMENT ON FUNCTION match_portfolio_documents IS 'Performs similarity search using cosine similarity';