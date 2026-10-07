CREATE TABLE `map_pins` (
	`id` text PRIMARY KEY NOT NULL,
	`map_id` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`color` text DEFAULT 'moss' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`target_note_id` text,
	`target_person_id` text,
	`target_planting_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`map_id`) REFERENCES `maps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_planting_id`) REFERENCES `plantings`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "map_pins_label_length" CHECK(length("map_pins"."label") <= 80),
	CONSTRAINT "map_pins_note_length" CHECK(length("map_pins"."note") <= 5000),
	CONSTRAINT "map_pins_one_target" CHECK(("map_pins"."target_note_id" IS NOT NULL) + ("map_pins"."target_person_id" IS NOT NULL) + ("map_pins"."target_planting_id" IS NOT NULL) <= 1)
);
--> statement-breakpoint
CREATE INDEX `map_pins_map_idx` ON `map_pins` (`map_id`);--> statement-breakpoint
CREATE INDEX `map_pins_note_idx` ON `map_pins` (`target_note_id`);--> statement-breakpoint
CREATE INDEX `map_pins_person_idx` ON `map_pins` (`target_person_id`);--> statement-breakpoint
CREATE INDEX `map_pins_planting_idx` ON `map_pins` (`target_planting_id`);--> statement-breakpoint
CREATE TABLE `maps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scene` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "maps_name_valid" CHECK(length("maps"."name") BETWEEN 1 AND 80 AND trim("maps"."name") <> ''),
	CONSTRAINT "maps_scene_length" CHECK(length("maps"."scene") <= 900000)
);
--> statement-breakpoint
CREATE INDEX `maps_updated_idx` ON `maps` (`deleted_at`,`updated_at`);