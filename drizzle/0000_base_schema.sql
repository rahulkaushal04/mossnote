CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`source_note_id` text NOT NULL,
	`target_note_id` text,
	`target_person_id` text,
	`target_planting_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_planting_id`) REFERENCES `plantings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "links_exactly_one_target" CHECK(("links"."target_note_id" IS NOT NULL) + ("links"."target_person_id" IS NOT NULL) + ("links"."target_planting_id" IS NOT NULL) = 1),
	CONSTRAINT "links_not_self" CHECK("links"."source_note_id" <> "links"."target_note_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_note_unique` ON `links` (`source_note_id`,`target_note_id`) WHERE "links"."target_note_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `links_person_unique` ON `links` (`source_note_id`,`target_person_id`) WHERE "links"."target_person_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `links_planting_unique` ON `links` (`source_note_id`,`target_planting_id`) WHERE "links"."target_planting_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `links_target_note_idx` ON `links` (`target_note_id`);--> statement-breakpoint
CREATE INDEX `links_target_person_idx` ON `links` (`target_person_id`);--> statement-breakpoint
CREATE INDEX `links_target_planting_idx` ON `links` (`target_planting_id`);--> statement-breakpoint
CREATE TABLE `note_tags` (
	`note_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`note_id`, `tag_id`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_tags_tag_idx` ON `note_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`body` text DEFAULT '' NOT NULL,
	`game_date` integer,
	`is_discovery` integer DEFAULT false NOT NULL,
	`question_state` text,
	`resolution` text,
	`solved_game_date` integer,
	`solved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "notes_has_content" CHECK(trim(coalesce("notes"."title", '')) <> '' OR trim("notes"."body") <> ''),
	CONSTRAINT "notes_title_length" CHECK("notes"."title" IS NULL OR length("notes"."title") <= 200),
	CONSTRAINT "notes_body_length" CHECK(length("notes"."body") <= 50000),
	CONSTRAINT "notes_is_discovery_bool" CHECK("notes"."is_discovery" IN (0, 1)),
	CONSTRAINT "notes_question_state_valid" CHECK("notes"."question_state" IS NULL OR "notes"."question_state" IN ('open', 'solved')),
	CONSTRAINT "notes_resolution_needs_question" CHECK("notes"."resolution" IS NULL OR "notes"."question_state" IS NOT NULL),
	CONSTRAINT "notes_resolution_length" CHECK("notes"."resolution" IS NULL OR length("notes"."resolution") <= 2000),
	CONSTRAINT "notes_solved_fields_need_solved" CHECK(("notes"."solved_game_date" IS NULL AND "notes"."solved_at" IS NULL) OR "notes"."question_state" = 'solved')
);
--> statement-breakpoint
CREATE INDEX `notes_timeline_idx` ON `notes` (`deleted_at`,`game_date`,`created_at`);--> statement-breakpoint
CREATE INDEX `notes_discovery_idx` ON `notes` (`created_at`) WHERE "notes"."is_discovery" = 1 AND "notes"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `notes_question_idx` ON `notes` (`question_state`,`created_at`) WHERE "notes"."question_state" IS NOT NULL AND "notes"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`progress` integer,
	`progress_max` integer,
	`custom_fields` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "people_name_valid" CHECK(length("people"."name") BETWEEN 1 AND 80 AND trim("people"."name") <> ''),
	CONSTRAINT "people_notes_length" CHECK(length("people"."notes") <= 20000),
	CONSTRAINT "people_progress_max_range" CHECK("people"."progress_max" IS NULL OR "people"."progress_max" BETWEEN 1 AND 99),
	CONSTRAINT "people_progress_valid" CHECK("people"."progress" IS NULL OR ("people"."progress_max" IS NOT NULL AND "people"."progress" BETWEEN 0 AND "people"."progress_max"))
);
--> statement-breakpoint
CREATE INDEX `people_name_idx` ON `people` ("name" COLLATE NOCASE) WHERE "people"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `person_tags` (
	`person_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`person_id`, `tag_id`),
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `person_tags_tag_idx` ON `person_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `planting_tags` (
	`planting_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`planting_id`, `tag_id`),
	FOREIGN KEY (`planting_id`) REFERENCES `plantings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `planting_tags_tag_idx` ON `planting_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `plantings` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`planted_on` integer,
	`harvested_on` integer,
	`planted_count` integer,
	`harvested_count` integer,
	`notes` text DEFAULT '' NOT NULL,
	`custom_fields` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "plantings_label_valid" CHECK(length("plantings"."label") BETWEEN 1 AND 80 AND trim("plantings"."label") <> ''),
	CONSTRAINT "plantings_notes_length" CHECK(length("plantings"."notes") <= 20000),
	CONSTRAINT "plantings_planted_count_range" CHECK("plantings"."planted_count" IS NULL OR "plantings"."planted_count" BETWEEN 0 AND 999999),
	CONSTRAINT "plantings_harvested_count_range" CHECK("plantings"."harvested_count" IS NULL OR "plantings"."harvested_count" BETWEEN 0 AND 999999),
	CONSTRAINT "plantings_harvest_not_before_planting" CHECK("plantings"."planted_on" IS NULL OR "plantings"."harvested_on" IS NULL OR "plantings"."harvested_on" >= "plantings"."planted_on")
);
--> statement-breakpoint
CREATE INDEX `plantings_planted_idx` ON `plantings` (`deleted_at`,`planted_on`);--> statement-breakpoint
CREATE INDEX `plantings_label_idx` ON `plantings` ("label" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "tags_name_length" CHECK(length("tags"."name") BETWEEN 1 AND 40),
	CONSTRAINT "tags_pinned_bool" CHECK("tags"."pinned" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_key_unique` ON `tags` (`name_key`);