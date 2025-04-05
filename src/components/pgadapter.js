import Pool from "pg-pool";
import DbAdapter from "./dbadapter.js";

export default class PgAdapter extends DbAdapter {
  constructor(config) {
    super(config);
    this.pool = null;
  }

  async connect() {
    this.pool = new Pool(this.config);
  }

  async disconnect() {
    await this.pool.end();
  }

  async getClient() {
    return await this.pool.connect();
  }

  async query(client, query, ...args) {
    try {
      return await client.query(query, args);
    } catch (error) {
      console.error("Database query error:", error);
      throw error;
    }
  }
}
