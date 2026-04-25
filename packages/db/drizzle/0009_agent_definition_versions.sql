CREATE TABLE "agent_definition_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_definition_versions_agent_version_uniq" UNIQUE("agent_id","version")
);
--> statement-breakpoint
ALTER TABLE "agent_definition_versions" ADD CONSTRAINT "agent_definition_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definition_versions" ADD CONSTRAINT "agent_definition_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_definition_versions_agent_idx" ON "agent_definition_versions" USING btree ("agent_id","version" DESC);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "current_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
INSERT INTO "agent_definition_versions" ("agent_id", "version", "snapshot", "created_at")
SELECT
	"id",
	1,
	(to_jsonb("agents".*)
		- 'id'
		- 'created_at'
		- 'updated_at'
		- 'last_active_at'
		- 'active_stream_id'
		- 'current_version'
		- 'archived_at'),
	"created_at"
FROM "agents"
ON CONFLICT ("agent_id","version") DO NOTHING;
