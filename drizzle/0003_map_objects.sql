CREATE TABLE `map_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`map_id` text NOT NULL,
	`name` text,
	`kind` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`map_id`) REFERENCES `maps`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "map_versions_name_length" CHECK("map_versions"."name" IS NULL OR length("map_versions"."name") <= 60)
);
--> statement-breakpoint
CREATE INDEX `map_versions_map_idx` ON `map_versions` (`map_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `map_pins` ADD `props` text DEFAULT '{}' NOT NULL;