export default class DbAdapter {
  constructor(config) {
    this.config = config;
  }
  async connect() {
    throw new Error("Not implemented");
  }
  async disconnect() {
    throw new Error("Not implemented");
  }
  async query(query, ...args) {
    throw new Error("Not implemented");
  }
  async beginTransaction() {
    throw new Error("Not implemented");
  }
  async commitTransaction() {
    throw new Error("Not implemented");
  }
  async rollbackTransaction() {
    throw new Error("Not implemented");
  }
}
