\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_search;
CREATE EXTENSION IF NOT EXISTS ltree;

SELECT json_build_object('extensions', json_object_agg(extname, extversion))
FROM pg_extension WHERE extname IN ('pg_search', 'vector', 'ltree');
SELECT json_build_object('jieba', '知识库协同编辑'::pdb.jieba::text[],
                         'icu', 'Knowledge collaboration 你好'::pdb.icu::text[]);

BEGIN;
CREATE TABLE public.fob_infra_probe (
  id bigint PRIMARY KEY,
  body_zh text NOT NULL,
  body_en text NOT NULL,
  embedding vector(3) NOT NULL,
  path ltree NOT NULL
);
INSERT INTO public.fob_infra_probe VALUES
  (1, '知识库支持协同编辑', 'Knowledge collaboration', '[1,0,0]', 'resources.page.block'),
  (2, '今天晴天', 'The weather is sunny', '[0,1,0]', 'other.page');
CREATE INDEX fob_infra_probe_search ON public.fob_infra_probe
USING paradedb (id, (body_zh::pdb.jieba), (body_en::pdb.icu)) WITH (key_field='id');
CREATE INDEX fob_infra_probe_vectors ON public.fob_infra_probe
USING hnsw (embedding vector_cosine_ops);
SELECT json_build_object(
  'chineseMatch', (SELECT array_agg(id) FROM public.fob_infra_probe WHERE body_zh @@@ '协同'),
  'englishMatch', (SELECT array_agg(id) FROM public.fob_infra_probe WHERE body_en @@@ 'collaboration'),
  'vectorNearest', (SELECT id FROM public.fob_infra_probe ORDER BY embedding <=> '[1,0,0]'::vector LIMIT 1),
  'ltreeMatch', (SELECT count(*) FROM public.fob_infra_probe WHERE path <@ 'resources'::ltree)
);
ROLLBACK;
