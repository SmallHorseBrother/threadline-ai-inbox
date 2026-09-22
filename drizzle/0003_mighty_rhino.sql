ALTER TABLE `tasks` ADD `account_alias` text DEFAULT '账号1' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_tasks_user_account_status` ON `tasks` (`user_id`,`account_alias`,`status`);