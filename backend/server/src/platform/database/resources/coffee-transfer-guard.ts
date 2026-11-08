/** Last line of defense for concurrent spending; invoker rights retain account RLS. */
export const coffeeTransferGuardSql = `
CREATE OR REPLACE FUNCTION resources.guard_coffee_transfer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $gift$
DECLARE available bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fob:coffee:' || NEW.sender_id::text,0));
  IF NOT EXISTS (SELECT 1 FROM resources.page WHERE knowledge_base_id=NEW.knowledge_base_id AND id=NEW.page_id AND created_by=NEW.recipient_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Coffee recipient unavailable' USING ERRCODE='23514';
  END IF;
  SELECT (SELECT count(*) FROM resources.coffee_ledger WHERE user_id=NEW.sender_id)
    + coalesce((SELECT sum(CASE WHEN recipient_id=NEW.sender_id THEN amount ELSE -amount END)
      FROM resources.coffee_transfer WHERE sender_id=NEW.sender_id OR recipient_id=NEW.sender_id),0) INTO available;
  IF available < NEW.amount THEN RAISE EXCEPTION 'Insufficient coffee balance' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$gift$;
DROP TRIGGER IF EXISTS coffee_transfer_balance_guard ON resources.coffee_transfer;
CREATE TRIGGER coffee_transfer_balance_guard BEFORE INSERT ON resources.coffee_transfer FOR EACH ROW EXECUTE FUNCTION resources.guard_coffee_transfer();
`;
