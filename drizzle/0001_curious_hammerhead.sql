CREATE INDEX `idx_tasks_user_status` ON `tasks` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_user_activity` ON `tasks` (`user_id`,`last_activity_at`);