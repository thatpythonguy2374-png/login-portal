-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE `cart` (
	`ID` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`product_id` int NOT NULL,
	`quantity` int NOT NULL,
	CONSTRAINT `cart_ID` PRIMARY KEY(`ID`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`ID` int AUTO_INCREMENT NOT NULL,
	`product_name` varchar(15) NOT NULL,
	`product_price` decimal(10,2) NOT NULL,
	`description` text,
	`quantity` int,
	CONSTRAINT `products_ID` PRIMARY KEY(`ID`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`token` text NOT NULL,
	`expires_at` datetime NOT NULL,
	`created_at` timestamp DEFAULT (CURRENT_TIMESTAMP),
	`revoked_at` datetime,
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`ID` int AUTO_INCREMENT NOT NULL,
	`NAME` varchar(20) NOT NULL,
	`USERNAME` varchar(20) NOT NULL,
	`PASSWORD` varchar(50) NOT NULL,
	`ROLE` varchar(20) NOT NULL,
	CONSTRAINT `users_ID` PRIMARY KEY(`ID`)
);
--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users`(`ID`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `user_id` ON `refresh_tokens` (`user_id`);
*/