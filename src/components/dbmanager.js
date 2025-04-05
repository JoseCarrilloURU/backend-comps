import argon2 from "argon2";

export default class DbManager {
  constructor(
    adapter,
    { allowDirectQueries = false, allowTransactions = false } = {}
  ) {
    this.adapter = adapter;
    this.isConnected = false;
    this.allowDirectQueries = allowDirectQueries;
    this.allowTransactions = allowTransactions;
  }

  async connect() {
    await this.adapter.connect();
    this.isConnected = true;
    return this;
  }

  async disconnect() {
    await this.adapter.disconnect();
    this.isConnected = false;
  }

  async getClient() {
    if (!this.isConnected) {
      throw new Error("Database is not connected");
    }
    return await this.adapter.getClient();
  }

  async query(client, query, ...args) {
    try {
      const response = await this.adapter.query(client, query, ...args);
      return response.rows;
    } catch (error) {
      console.error("Database query error:", error);
      throw error; // Re-throw the error to be handled by the caller
    }
  }

  async executeQuery(client, query, ...args) {
    if (!this.allowDirectQueries) {
      throw new Error("Direct queries are not allowed");
    }
    return await this.query(client, query, ...args);
  }

  async beginTransaction(client) {
    if (!this.allowTransactions) {
      throw new Error("Transactions are not allowed");
    }
    try {
      await client.query("BEGIN");
    } catch (error) {
      console.error("Error starting transaction:", error);
      throw error;
    }
    return this;
  }

  async commitTransaction(client) {
    if (!this.allowTransactions) {
      throw new Error("Transactions are not allowed");
    }
    try {
      await client.query("COMMIT");
    } catch (error) {
      console.error("Error committing transaction:", error);
      throw error;
    }
    return this;
  }

  async rollbackTransaction(client) {
    if (!this.allowTransactions) {
      throw new Error("Transactions are not allowed");
    }
    try {
      await client.query("ROLLBACK");
    } catch (error) {
      console.error("Error rolling back transaction:", error);
      throw error;
    }
    return this;
  }

  async insert(client, table, data) {
    const columns = Object.keys(data).join(", ");
    const values = Object.values(data);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    const query = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;
    try {
      await this.query(client, query, ...values);
      console.log(`${table} record inserted successfully`);
    } catch (error) {
      console.error(`Error inserting into ${table}:`, error);
      throw error;
    }
  }

  async modify(client, table, column, newValue, condition, conditionValue) {
    // Check if the record exists
    const record = await this.select(client, table, condition, conditionValue);
    if (!record) {
      throw new Error(
        `Record not found in ${table} where ${condition} = ${conditionValue}`
      );
    }

    // Proceed with the modification
    const query = `UPDATE ${table} SET ${column} = $1 WHERE ${condition} = $2`;
    try {
      await this.query(client, query, newValue, conditionValue);
      console.log(`${table} record updated successfully`);
    } catch (error) {
      console.error(`Error updating ${table}:`, error);
      throw error;
    }
  }

  async delete(client, table, condition, value) {
    // Check if the record exists
    const record = await this.select(client, table, condition, value);
    if (!record) {
      throw new Error(
        `Record not found in ${table} where ${condition} = ${value}`
      );
    }

    // Proceed with the deletion
    const query = `DELETE FROM ${table} WHERE ${condition} = $1`;
    try {
      await this.query(client, query, value);
      console.log(`${table} record deleted successfully`);
    } catch (error) {
      console.error(`Error deleting from ${table}:`, error);
      throw error;
    }
  }

  async select(client, table, condition, value) {
    const query = `SELECT * FROM ${table} WHERE ${condition} = $1`;
    try {
      const result = await this.query(client, query, value);
      return result[0];
    } catch (error) {
      console.error(`Error selecting from ${table}:`, error);
      throw error;
    }
  }

  async verifyPassword(hashedPassword, password) {
    return await argon2.verify(hashedPassword, password);
  }

  async withClient(callback) {
    const client = await this.getClient();
    try {
      return await callback(client);
    } catch (error) {
      throw error;
    } finally {
      client.release(); // Ensure the client is always released
    }
  }

  async withTransaction(callback) {
    return await this.withClient(async (client) => {
      try {
        await this.beginTransaction(client);
        const result = await callback(client);
        await this.commitTransaction(client);
        return result;
      } catch (error) {
        await this.rollbackTransaction(client);
        throw error;
      }
    });
  }
}
