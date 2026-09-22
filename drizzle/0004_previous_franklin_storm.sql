CREATE TABLE `device_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_name` text NOT NULL,
	`account_alias` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text,
	`last_sync_at` text,
	`last_scan_id` text,
	`agent_version` text,
	`record_count` integer DEFAULT 0 NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_device_sources_token_hash` ON `device_sources` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_device_sources_user_status` ON `device_sources` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `task_source_presence` (
	`task_id` text NOT NULL,
	`source_id` text NOT NULL,
	`last_scan_id` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`source_revision` text,
	`is_present` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`task_id`, `source_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `device_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_source_presence_source` ON `task_source_presence` (`source_id`,`is_present`);