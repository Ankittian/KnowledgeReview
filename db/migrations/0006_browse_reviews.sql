ALTER TABLE "card_reviews" ALTER COLUMN "deck_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "card_reviews" ADD COLUMN "source" text DEFAULT 'daily' NOT NULL;
