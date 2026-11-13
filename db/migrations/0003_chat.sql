CREATE TYPE "public"."answer_role" AS ENUM('technical', 'functional', 'product');--> statement-breakpoint
CREATE TYPE "public"."chat_feedback_value" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."chat_message_status" AS ENUM('ok', 'streaming', 'stopped', 'error');--> statement-breakpoint
CREATE TYPE "public"."chat_sender" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "chat_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"value" "chat_feedback_value" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender" "chat_sender" NOT NULL,
	"reply_to_id" bigint,
	"content" text DEFAULT '' NOT NULL,
	"status" "chat_message_status" DEFAULT 'ok' NOT NULL,
	"error_code" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"duration_ms" integer,
	"num_turns" integer,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_tool_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" bigint NOT NULL,
	"tool_use_id" text,
	"tool_name" text NOT NULL,
	"arguments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed" boolean NOT NULL,
	"is_error" boolean,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"role_used" "answer_role" NOT NULL,
	"claude_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_answer_roles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"answer_role" "answer_role" NOT NULL,
	"set_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tool_calls" ADD CONSTRAINT "chat_tool_calls_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_answer_roles" ADD CONSTRAINT "user_answer_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_feedback_msg_user" ON "chat_feedback" USING btree ("message_id","user_id");--> statement-breakpoint
CREATE INDEX "chat_messages_conv_idx" ON "chat_messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "chat_messages_created_idx" ON "chat_messages" USING btree ("sender","created_at");--> statement-breakpoint
CREATE INDEX "chat_tool_calls_msg_idx" ON "chat_tool_calls" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "chat_tool_calls_denied_idx" ON "chat_tool_calls" USING btree ("allowed","created_at");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id","updated_at");