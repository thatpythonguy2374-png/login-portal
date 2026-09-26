require("dotenv").config();

const mysql = require("mysql2/promise");
const { drizzle } = require("drizzle-orm/mysql2");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB,
});

const db = drizzle(pool);

module.exports = db;
