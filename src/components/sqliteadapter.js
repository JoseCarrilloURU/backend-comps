import sqlite3 from "sqlite3";
import { open } from "sqlite";
import DbAdapter from "./dbadapter.js";

export default class SQLiteAdapter extends DbAdapter {
  constructor(config) {
    super(config);
    this.db = null;
  }

  async connect() {
    try {
      this.db = await open({
        filename: this.config.database, // Path to SQLite database file
        driver: sqlite3.Database,
      });
      console.log("Connected to SQLite database.");
    } catch (error) {
      console.error("Error connecting to SQLite database:", error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.db) {
        await this.db.close();
        console.log("Disconnected from SQLite database.");
      }
    } catch (error) {
      console.error("Error disconnecting from SQLite database:", error);
      throw error;
    }
  }

  async getClient() {
    if (!this.db) {
      throw new Error("Database is not connected");
    }
    return this.db; // SQLite does not use connection pooling
  }

  async query(client, query, ...args) {
    try {
      if (query.trim().toLowerCase().startsWith("select")) {
        return await client.all(query, ...args); // For SELECT queries
      } else {
        return await client.run(query, ...args); // For INSERT, UPDATE, DELETE queries
      }
    } catch (error) {
      console.error("Database query error:", error);
      throw error;
    }
  }
}

// Example usage of SQLiteAdapter and DbManager in a Node.js application

// import SQLiteAdapter from "./components/sqliteadapter.js";
// import DbManager from "./components/dbmanager.js";

// const dbConfig = {
//   database: "./path/to/your-database.sqlite", // Path to SQLite database file
// };

// const sqliteAdapter = new SQLiteAdapter(dbConfig);
// const dbManager = new DbManager(sqliteAdapter, {
//   allowDirectQueries: true,
//   allowTransactions: true,
// });

// (async () => {
//   await dbManager.connect();

//   const client = await dbManager.getClient();
//   try {
//     // Example query
//     const result = await dbManager.query(client, "SELECT * FROM users");
//     console.log("Users:", result);
//   } catch (error) {
//     console.error("Error:", error);
//   } finally {
//     await dbManager.disconnect();
//   }
// })();
