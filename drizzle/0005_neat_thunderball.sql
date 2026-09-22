CREATE TABLE `task_ai_analysis` (
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`context_hash` text NOT NULL,
	`semantic_state` text NOT NULL,
	`confidence` integer NOT NULL,
	`reason` text NOT NULL,
	`next_action` text NOT NULL,
	`model` text NOT NULL,
	`analyzed_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `task_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_task_ai_analysis_user_time` ON `task_ai_analysis` (`user_id`,`analyzed_at`);
--> statement-breakpoint
PRAGMA optimize;
