const {
  mysqlTable,
  primaryKey,
  int,
  text,
  index,
  datetime,
  timestamp,
} = require("drizzle-orm/mysql-core");

// USERS table reference
// Required because refresh_tokens.user_id references users.ID
const users = mysqlTable(
  "users",
  {
    id: int("ID").autoincrement().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.id],
      name: "users_ID",
    }),
  ],
);

// REFRESH TOKENS
const refreshTokens = mysqlTable(
  "refresh_tokens",
  {
    id: int().autoincrement().notNull(),

    userId: int("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    token: text().notNull(),

    expiresAt: datetime("expires_at", {
      mode: "string",
    }).notNull(),

    createdAt: timestamp("created_at", {
      mode: "string",
    }).defaultNow(),

    revokedAt: datetime("revoked_at", {
      mode: "string",
    }),
  },
  (table) => [
    index("user_id").on(table.userId),

    primaryKey({
      columns: [table.id],
      name: "refresh_tokens_id",
    }),
  ],
);

module.exports = {
  refreshTokens,
};
