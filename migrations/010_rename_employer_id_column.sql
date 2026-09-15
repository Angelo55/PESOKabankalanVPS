-- Renames pesoadmin_job_posts.employer_id -> peso_admin_id. Drop/re-add the self
-- FK so the column rename is portable across TiDB versions. The index follows the
-- column automatically; the re-added FK reuses it.
SET FOREIGN_KEY_CHECKS = 0;
ALTER TABLE pesoadmin_job_posts DROP FOREIGN KEY pesoadmin_job_posts_ibfk_1;
ALTER TABLE pesoadmin_job_posts CHANGE COLUMN employer_id peso_admin_id INT NOT NULL;
ALTER TABLE pesoadmin_job_posts
	ADD CONSTRAINT pesoadmin_job_posts_ibfk_1 FOREIGN KEY (peso_admin_id) REFERENCES users (id) ON DELETE CASCADE;
SET FOREIGN_KEY_CHECKS = 1;