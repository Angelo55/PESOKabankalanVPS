-- Renames the PESO Admin job-posts table. FK checks disabled only to satisfy
-- engines that validate referenced-table renames; RENAME moves no data.
-- Child FKs (conversations, job_applications, pesoadmin_applications) auto-follow.
SET FOREIGN_KEY_CHECKS = 0;
RENAME TABLE pesoadmin_job_posts TO pesoadmin_job_posts;
SET FOREIGN_KEY_CHECKS = 1;