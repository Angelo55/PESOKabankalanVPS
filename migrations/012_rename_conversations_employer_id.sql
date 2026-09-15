-- Renames conversations.employer_id -> peso_admin_id (the PESO Admin chat
-- participant), matching pesoadmin_job_posts.peso_admin_id. FK-referencing
-- column, so drop/rename/re-add the self FK.
SET FOREIGN_KEY_CHECKS = 0;
ALTER TABLE conversations DROP FOREIGN KEY conversations_ibfk_1;
ALTER TABLE conversations CHANGE COLUMN employer_id peso_admin_id INT NOT NULL;
ALTER TABLE conversations
	ADD CONSTRAINT conversations_ibfk_1 FOREIGN KEY (peso_admin_id) REFERENCES users (id) ON DELETE CASCADE;
SET FOREIGN_KEY_CHECKS = 1;