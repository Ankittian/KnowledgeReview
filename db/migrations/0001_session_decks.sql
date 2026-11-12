ALTER TABLE "daily_decks" DROP CONSTRAINT "daily_decks_user_id_deck_date_pk";--> statement-breakpoint
ALTER TABLE "daily_decks" ADD COLUMN "id" serial PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_decks" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "deck_id" integer;--> statement-breakpoint
CREATE INDEX "daily_decks_user_day_idx" ON "daily_decks" USING btree ("user_id","deck_date");--> statement-breakpoint
CREATE INDEX "daily_decks_session_idx" ON "daily_decks" USING btree ("session_id","deck_date");