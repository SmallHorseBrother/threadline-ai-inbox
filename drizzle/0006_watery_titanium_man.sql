CREATE TABLE `executive_summary_cache` (
	`user_id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`summary` text NOT NULL,
	`actions` text NOT NULL,
	`model` text NOT NULL,
	`generated_at` text NOT NULL
);
