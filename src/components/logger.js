import SQLiteAdapter from "./sqliteadapter.js";
import { WebSocketServer } from "ws";
import path from "path";
import osu from "node-os-utils";
import ip from "ip";

const dbConfig = { database: "./logs.sqlite" };
const sqliteAdapter = new SQLiteAdapter(dbConfig);

await sqliteAdapter.connect();

const logger = {
  async main(req, res, next) {
    const start = Date.now();
    res.on("finish", async () => {
      const logType = res.statusCode >= 400 ? "Error" : "Request";
      const memoryUsage = (process.memoryUsage().rss / (1024 * 1024)).toFixed(
        2
      );
      let ipAddress = req.ip;
      if (ipAddress === "::1") {
        ipAddress = "127.0.0.1";
      } else if (ip.isV6Format(ipAddress)) {
        ipAddress = ip.toString(ip.toBuffer(ipAddress));
      }

      await logger.insertLog("logs", {
        timestamp: new Date().toISOString(),
        endpoint: req.originalUrl,
        ip: ipAddress,
        method: req.method,
        body: JSON.stringify(req.body),
        logType,
        message: `Request to ${req.originalUrl}`,
        responseTime: Date.now() - start,
        usage: `${memoryUsage} MB`,
      });
    });
    next();
  },

  async insertLog(table, data) {
    const columns = Object.keys(data).join(", ");
    const placeholders = Object.keys(data)
      .map(() => "?")
      .join(", ");
    const values = Object.values(data);

    const query = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;
    try {
      const client = await sqliteAdapter.getClient();
      await sqliteAdapter.query(client, query, ...values);
    } catch (error) {
      console.error(`Error inserting log into ${table}:`, error);
    }
  },

  async logInfo(message, endpoint = "N/A") {
    await this.insertLog("userLogs", {
      timestamp: new Date().toISOString(),
      endpoint,
      logType: "Info",
      message,
    });
  },

  async logError(message, endpoint = "N/A") {
    await this.insertLog("userLogs", {
      timestamp: new Date().toISOString(),
      endpoint,
      logType: "Error",
      message,
    });
  },

  async logWarning(message, endpoint = "N/A") {
    await this.insertLog("userLogs", {
      timestamp: new Date().toISOString(),
      endpoint,
      logType: "Warning",
      message,
    });
  },

  async logDebug(message, endpoint = "N/A") {
    await this.insertLog("userLogs", {
      timestamp: new Date().toISOString(),
      endpoint,
      logType: "Debug",
      message,
    });
  },

  setup(app) {
    app.get("/logs", async (req, res) => {
      try {
        const client = await sqliteAdapter.getClient();
        const logs = await sqliteAdapter.query(
          client,
          "SELECT id, timestamp, endpoint, ip, method, body, logType, message, responseTime, usage FROM logs"
        );
        res.json(logs);
      } catch (error) {
        console.error("Error fetching logs:", error);
        res.status(500).json({ error: "Failed to fetch logs" });
      }
    });

    app.get("/download-logs", (req, res) => {
      const filePath = path.resolve("./logs.sqlite");
      res.download(filePath, "logs.sqlite", (err) => {
        if (err) {
          console.error("Error downloading logs file:", err);
          res.status(500).json({ error: "Failed to download logs file" });
        }
      });
    });

    const wss = new WebSocketServer({ port: 8080 });

    wss.on("connection", (ws) => {
      console.log("Client connected to WebSocket");

      const interval = setInterval(async () => {
        try {
          const cpuUsage = await osu.cpu.usage();
          const memoryUsageApp = (
            process.memoryUsage().rss /
            (1024 * 1024)
          ).toFixed(2);
          const memoryUsage = await osu.mem.info();

          const metrics = {
            cpuUsage: `${cpuUsage.toFixed(2)}%`,
            memoryUsageApp: `${memoryUsageApp} MB`,
            memoryUsage: `${memoryUsage.usedMemMb} MB`,
          };

          const client = await sqliteAdapter.getClient();
          const logs = await sqliteAdapter.query(
            client,
            "SELECT id, timestamp, endpoint, ip, method, body, logType, message, responseTime, usage FROM logs"
          );
          const userLogs = await sqliteAdapter.query(
            client,
            "SELECT id, timestamp, endpoint, logType, message FROM userLogs"
          );

          ws.send(JSON.stringify({ metrics, logs, userLogs }));
        } catch (error) {
          console.error("Error in WebSocket interval:", error);
        }
      }, 1000);

      ws.on("close", () => {
        clearInterval(interval);
        console.log("Client disconnected from WebSocket");
      });
    });
  },
};

export default logger;
