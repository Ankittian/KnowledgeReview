-- Fold user_answer_roles (one value per user) into users.answer_role; who changed it is kept in the audit log.
ALTER TABLE "users" ADD COLUMN "answer_role" "answer_role";--> statement-breakpoint
UPDATE "users" SET "answer_role" = "user_answer_roles"."answer_role" FROM "user_answer_roles" WHERE "user_answer_roles"."user_id" = "users"."id";--> statement-breakpoint
DROP TABLE "user_answer_roles";--> statement-breakpoint
-- Written but never read.
ALTER TABLE "kb_items" DROP COLUMN "last_synced_at";--> statement-breakpoint
ALTER TABLE "login_sessions" DROP COLUMN "user_agent";
