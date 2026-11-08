/** Invoker-rights triggers preserve the existing knowledge-base RLS boundary. */
export const documentActivityRetentionSql = `
CREATE OR REPLACE FUNCTION resources.retain_page_activity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $retention$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_NAME || ':' || NEW.knowledge_base_id::text || ':' || NEW.page_id::text, 0));
  IF TG_TABLE_NAME = 'document_visit' THEN
    DELETE FROM resources.document_visit WHERE knowledge_base_id=NEW.knowledge_base_id AND page_id=NEW.page_id AND user_id IN (
      SELECT user_id FROM resources.document_visit WHERE knowledge_base_id=NEW.knowledge_base_id AND page_id=NEW.page_id
      ORDER BY last_viewed_at DESC, user_id DESC OFFSET 20
    );
  ELSIF TG_TABLE_NAME = 'document_edit' THEN
    DELETE FROM resources.document_edit WHERE knowledge_base_id=NEW.knowledge_base_id AND page_id=NEW.page_id AND id IN (
      SELECT id FROM resources.document_edit WHERE knowledge_base_id=NEW.knowledge_base_id AND page_id=NEW.page_id
      ORDER BY created_at DESC, id DESC OFFSET 20
    );
  ELSE
    DELETE FROM resources.doc_checkpoint WHERE knowledge_base_id=NEW.knowledge_base_id AND page_id=NEW.page_id AND id IN (
      SELECT id FROM resources.doc_checkpoint WHERE knowledge_base_id=NEW.knowledge_base_id AND page_id=NEW.page_id
      ORDER BY created_at DESC, id DESC OFFSET 15
    );
  END IF;
  RETURN NEW;
END;
$retention$;
DROP TRIGGER IF EXISTS document_visit_retention ON resources.document_visit;
CREATE TRIGGER document_visit_retention AFTER INSERT OR UPDATE OF last_viewed_at ON resources.document_visit FOR EACH ROW EXECUTE FUNCTION resources.retain_page_activity();
DROP TRIGGER IF EXISTS document_edit_retention ON resources.document_edit;
CREATE TRIGGER document_edit_retention AFTER INSERT ON resources.document_edit FOR EACH ROW EXECUTE FUNCTION resources.retain_page_activity();
DROP TRIGGER IF EXISTS doc_checkpoint_retention ON resources.doc_checkpoint;
CREATE TRIGGER doc_checkpoint_retention AFTER INSERT ON resources.doc_checkpoint FOR EACH ROW EXECUTE FUNCTION resources.retain_page_activity();
`;

/** Only the explicitly requested excess history is removed; live bodies and jobs remain authoritative. */
export const trimExistingPageActivitySql = `
DELETE FROM resources.document_visit target USING (
  SELECT knowledge_base_id,page_id,user_id,row_number() OVER (PARTITION BY knowledge_base_id,page_id ORDER BY last_viewed_at DESC,user_id DESC) AS rank
  FROM resources.document_visit
) old WHERE old.rank>20 AND target.knowledge_base_id=old.knowledge_base_id AND target.page_id=old.page_id AND target.user_id=old.user_id;
DELETE FROM resources.document_edit target USING (
  SELECT knowledge_base_id,id,row_number() OVER (PARTITION BY knowledge_base_id,page_id ORDER BY created_at DESC,id DESC) AS rank
  FROM resources.document_edit
) old WHERE old.rank>20 AND target.knowledge_base_id=old.knowledge_base_id AND target.id=old.id;
DELETE FROM resources.doc_checkpoint target USING (
  SELECT knowledge_base_id,id,row_number() OVER (PARTITION BY knowledge_base_id,page_id ORDER BY created_at DESC,id DESC) AS rank
  FROM resources.doc_checkpoint
) old WHERE old.rank>15 AND target.knowledge_base_id=old.knowledge_base_id AND target.id=old.id;
`;
