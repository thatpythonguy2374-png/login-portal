require("dotenv").config();
const { defineConfig } = require("drizzle-kit");

module.exports = defineConfig({
  dialect: "mysql",
  schema: "./schema.js",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
