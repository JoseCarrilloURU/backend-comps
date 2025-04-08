import SQLiteAdapter from "./sqliteadapter.js";
import { WebSocketServer } from "ws";
import path from "path";
import osu from "node-os-utils";
import os from "os";
import ip from "ip";
import multer from "multer";
import fs from "fs";
import pkg from "sqlite3";

const { Database } = pkg;

const dbConfig = { database: "./logs.sqlite" };
const sqliteAdapter = new SQLiteAdapter(dbConfig);

const upload = multer({ storage: multer.memoryStorage() });

await sqliteAdapter.connect();

const logger = {
  async main(req, res, next) {
    const excludedEndpoints = [
      "/search-logs",
      "/search-userlogs",
      "/download-logs",
      "/import-logs",
    ];
    if (
      excludedEndpoints.some((endpoint) => req.originalUrl.startsWith(endpoint))
    ) {
      return next();
    }
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

    app.post("/import-logs", upload.single("file"), async (req, res) => {
      console.log("Incoming request: ", req.file);

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const tempPath = path.join(
        os.tmpdir(),
        `${Date.now()}-${req.file.originalname}`
      );
      try {
        await fs.promises.writeFile(tempPath, req.file.buffer);

        const getRecords = (db, query) => {
          return new Promise((resolve, reject) => {
            db.all(query, (err, rows) => (err ? reject(err) : resolve(rows)));
          });
        };

        const importedDB = new Database(tempPath);
        const importedLogs = await getRecords(importedDB, "SELECT * FROM logs");
        const importedUserLogs = await getRecords(
          importedDB,
          "SELECT * FROM userLogs"
        );
        importedDB.close();

        const client = await sqliteAdapter.getClient();

        await sqliteAdapter.query(client, "DELETE FROM logs");
        await sqliteAdapter.query(client, "DELETE FROM userLogs");

        await sqliteAdapter.query(
          client,
          "DELETE FROM sqlite_sequence WHERE name='logs'"
        );
        await sqliteAdapter.query(
          client,
          "DELETE FROM sqlite_sequence WHERE name='userLogs'"
        );

        const insertImportedLogs = async (table, record) => {
          const columns = Object.keys(record).filter((col) => col !== "id");
          const placeholders = columns.map(() => "?").join(", ");
          const values = columns.map((col) => record[col]);
          const query = `INSERT INTO ${table} (${columns.join(
            ", "
          )}) VALUES (${placeholders})`;
          await sqliteAdapter.query(client, query, ...values);
        };

        for (const log of importedLogs) {
          await insertImportedLogs("logs", log);
        }

        for (const log of importedUserLogs) {
          await insertImportedLogs("userLogs", log);
        }

        res.json({ message: "Logs imported successfully" });
      } catch (e) {
        console.error("Error importing logs:", e);
        res.status(500).json({ error: "Failed to import logs" });
      } finally {
        await fs.promises.unlink(tempPath);
      }
    });

    app.get("/search-logs", async (req, res) => {
      const search = req.query.search || "";
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;

      console.log(
        `Request received - Search: "${search}", Page: ${page}, Limit: ${limit}, Offset: ${offset}`
      );

      try {
        const client = await sqliteAdapter.getClient();

        const totalResult = await sqliteAdapter.query(
          client,
          "SELECT COUNT(*) as total FROM logs WHERE endpoint LIKE ? OR message LIKE ?",
          [`%${search}%`, `%${search}%`]
        );
        const total = totalResult[0].total;

        const logs = await sqliteAdapter.query(
          client,
          "SELECT * FROM logs WHERE endpoint LIKE ? OR message LIKE ? ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?",
          [`%${search}%`, `%${search}%`, limit, offset]
        );

        console.log(`Returning ${logs.length} logs for page ${page}`);

        res.json({
          page: page,
          limit,
          total,
          logs,
        });
      } catch (error) {
        console.error("Error searching for logs:", error);
        res.status(500).json({
          error: "Error searching logs",
          details: error.message,
          requestParams: {
            search,
            page,
            limit,
            offset,
          },
        });
      }
    });

    app.get("/search-userlogs", async (req, res) => {
      const search = req.query.search || "";
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;

      try {
        const client = await sqliteAdapter.getClient();

        const totalResult = await sqliteAdapter.query(
          client,
          "SELECT COUNT(*) as total FROM userLogs WHERE endpoint LIKE ? OR logType LIKE ?",
          [`%${search}%`, `%${search}%`]
        );

        // Consulta paginada
        const userLogs = await sqliteAdapter.query(
          client,
          `SELECT * FROM userLogs 
           WHERE endpoint LIKE ? OR logType LIKE ? 
           ORDER BY timestamp DESC, id DESC 
           LIMIT ? OFFSET ?`,
          [`%${search}%`, `%${search}%`, limit, offset]
        );

        res.json({
          page,
          limit,
          total: totalResult[0].total,
          userLogs,
        });
      } catch (error) {
        console.error("Error searching user logs:", error);
        res.status(500).json({ error: "Error searching user logs" });
      }
    });

    const wss = new WebSocketServer({ port: 8080 });

    wss.on("connection", (ws) => {
      console.log("Client connected to WebSocket");

      const clientState = {
        currentPage: 1,
        limit: 10,
        searchTerm: "",
      };

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

          const totalResults = await sqliteAdapter.query(
            client,
            "SELECT COUNT(*) as total FROM logs"
          );

          const logs = await sqliteAdapter.query(
            client,
            `SELECT * FROM logs ORDER BY timestamp DESC, id DESC LIMIT ?`,
            [clientState.limit]
          );

          const userLogTotal = await sqliteAdapter.query(
            client,
            "SELECT COUNT(*) as total FROM userLogs"
          );

          const userLogs = await sqliteAdapter.query(
            client,
            "SELECT id, timestamp, endpoint, logType, message FROM userLogs"
          );

          ws.send(
            JSON.stringify({
              metrics,
              logs,
              logsTotal: totalResults,
              userLogs,
              userLogsTotal: userLogTotal,
              pagination: {
                page: clientState.currentPage,
                limit: clientState.limit,
              },
            })
          );
        } catch (error) {
          console.error("Error in WebSocket interval:", error);
        }
      }, 1000);

      ws.on("message", (message) => {
        try {
          const data = JSON.parse(message);
          if (data.page) clientState.currentPage = data.page;
          if (data.limit) clientState.limit = data.limit;
          if (data.searchTerm !== undefined)
            clientState.searchTerm = data.searchTerm;
        } catch (e) {
          console.error("Error processing WS message:", e);
        }
      });

      ws.on("close", () => {
        clearInterval(interval);
        console.log("Client disconnected from WebSocket");
      });
    });
  },
};

export default logger;
