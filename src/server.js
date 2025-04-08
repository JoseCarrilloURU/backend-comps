import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import {
  authenticateToken,
  generateAccessToken,
  generateRefreshToken,
  authorize,
} from "./components/auth.js";
import PgAdapter from "./components/pgadapter.js";
import DbManager from "./components/dbmanager.js";
import logger from "./components/logger.js";
import { sendTextMail, sendTemplateMail } from "./components/mailer.js";
import argon2 from "argon2";
import cors from "cors";

dotenv.config();

const app = express();
const port = 3000;
const secretKey = process.env.SECRET_KEY;

const dbConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
};

const pgAdapter = new PgAdapter(dbConfig);
const dbManager = new DbManager(pgAdapter, {
  allowDirectQueries: true,
  allowTransactions: true,
});

app.use(cors());
app.use(bodyParser.json());
app.use(logger.main);
logger.setup(app);

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const client = await dbManager.getClient();
  try {
    const user = await dbManager.select(client, "users", "username", username);
    if (user && (await argon2.verify(user.password, password))) {
      const accessToken = generateAccessToken(
        {
          id: user.id,
          name: user.username,
          role: user.role,
          email: user.email,
        },
        secretKey
      );
      const refreshToken = generateRefreshToken(
        {
          id: user.id,
          name: user.username,
          role: user.role,
          email: user.email,
        },
        secretKey
      );
      await logger.logInfo(`User ${username} logged in successfully`, "/login");
      res.json({
        accessToken,
        refreshToken,
        email: user.email,
      });
    } else {
      await logger.logWarning(
        `Invalid login attempt for user ${username}`,
        "/login"
      );
      res.status(403).json({ error: "Invalid credentials" });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/token", (req, res) => {
  const { token } = req.body;
  console.log("Token request:", req.body); // Log token request data
  if (!token) {
    logger.logWarning("No se metio un token bb.");
    return res.status(401).json({ error: "No refresh token provided" });
  }

  jwt.verify(token, secretKey, (err, user) => {
    if (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Refresh token expired" });
      }
      return res.status(403).json({ error: "Invalid refresh token" });
    }
    const accessToken = generateAccessToken(
      { id: user.id, name: user.name, role: user.role, email: user.email },
      secretKey
    );
    console.log("Generated access token:", accessToken); // Log generated access token
    res.json({ accessToken });
  });
  logger.logDebug("Token generado");
});

app.get("/protected", authenticateToken, (req, res) => {
  res.json({ message: "This is a protected route", user: req.user });
});

app.get("/check-role", authenticateToken, (req, res) => {
  res.json({ role: req.user.role });
});

app.get(
  "/users",
  authenticateToken,
  authorize(["create_user", "delete_user"]),
  async (req, res) => {
    const client = await dbManager.getClient();
    try {
      const result = await dbManager.query(
        client,
        "SELECT id, username, email, role FROM users"
      );
      console.log("Users data:", result); // Log users data
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Database query failed" });
    }
  }
);

app.post(
  "/text-mail",
  authenticateToken,
  authorize(["send_mail"]),
  (req, res) => {
    const { to, subject, text } = req.body;
    console.log("Text mail request:", req.body); // Log text mail request data

    try {
      sendTextMail(to, subject, text); // Call the sendTextMail function
      res.json({ message: "Text email sent successfully" });
    } catch (error) {
      console.error("Error sending text email:", error);
      res.status(500).json({ error: "Failed to send text email" });
    }
  }
);

app.post(
  "/template-mail",
  authenticateToken,
  authorize(["send_mail"]),
  (req, res) => {
    const { to, subject, templateName } = req.body;
    console.log("Template mail request:", req.body); // Log template mail request data

    try {
      sendTemplateMail(to, subject, templateName); // Call the sendTemplateMail function
      res.json({ message: "Template email sent successfully" });
    } catch (error) {
      console.error("Error sending template email:", error);
      res.status(500).json({ error: "Failed to send template email" });
    }
  }
);

app.delete(
  "/users",
  authenticateToken,
  authorize(["delete_user"]),
  async (req, res) => {
    const { user_ids } = req.body;
    console.log("Delete users request:", req.body); // Log delete users request data
    const client = await dbManager.getClient();
    try {
      await dbManager.beginTransaction(client);
      for (const userId of user_ids) {
        await dbManager.delete(client, "users", "id", userId);
      }
      await dbManager.commitTransaction(client);
      res.status(200).json({ message: "Users deleted successfully" });
    } catch (error) {
      await dbManager.rollbackTransaction(client);
      console.error("Delete users error:", error);
      res.status(500).json({ error: "Failed to delete users" });
    }
  }
);

app.post(
  "/users",
  authenticateToken,
  authorize(["create_user"]),
  async (req, res) => {
    const { username, password, email, role } = req.body;
    console.log("Create user request:", req.body); // Log create user request data
    const client = await dbManager.getClient();
    try {
      const hashedPassword = await argon2.hash(password);
      await dbManager.insert(client, "users", {
        username,
        password: hashedPassword,
        email,
        role,
      });
      res.status(201).json({ message: "User added successfully" });
    } catch (error) {
      console.error("Insert user error:", error);
      res.status(500).json({ error: "Failed to add user" });
    }
  }
);

// Insert Route
app.post(
  "/db/insert",
  authenticateToken,
  authorize(["create_user"]),
  async (req, res) => {
    const { table, data } = req.body;
    try {
      await dbManager.withClient(async (client) => {
        if (table === "users" && data.password) {
          data.password = await argon2.hash(data.password);
        }
        await dbManager.insert(client, table, data);
      });
      res
        .status(201)
        .json({ message: `Record inserted into ${table} successfully` });
    } catch (error) {
      console.error("Insert error:", error);
      res.status(500).json({ error: "Failed to insert record" });
    }
  }
);

// Delete Route
app.post(
  "/db/delete",
  authenticateToken,
  authorize(["delete_user"]),
  async (req, res) => {
    const { table, condition, value } = req.body;
    console.log("Delete request:", req.body); // Log delete request data

    try {
      await dbManager.withClient(async (client) => {
        await dbManager.delete(client, table, condition, value);
      });
      res
        .status(200)
        .json({ message: `Record deleted from ${table} successfully` });
    } catch (error) {
      console.error("Delete error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to delete record" });
    }
  }
);

// Modify Route
app.post(
  "/db/modify",
  authenticateToken,
  authorize(["modify_user"]),
  async (req, res) => {
    const { table, column, newValue, condition, conditionValue } = req.body;
    console.log("Modify request:", req.body); // Log modify request data

    try {
      await dbManager.withClient(async (client) => {
        await dbManager.modify(
          client,
          table,
          column,
          newValue,
          condition,
          conditionValue
        );
      });
      res
        .status(200)
        .json({ message: `Record in ${table} updated successfully` });
    } catch (error) {
      console.error("Modify error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to modify record" });
    }
  }
);

app.post(
  "/transaction-create-modify",
  authenticateToken,
  authorize(["create_user", "modify_user"]),
  async (req, res) => {
    const { newUser, modifyUser } = req.body;
    try {
      await dbManager.withTransaction(async (client) => {
        const hashedPassword = await argon2.hash(newUser.password);
        await dbManager.insert(client, "users", {
          username: newUser.username,
          password: hashedPassword,
          email: newUser.email,
          role: newUser.role,
        });
        await dbManager.modify(
          client,
          "users",
          modifyUser.column,
          modifyUser.newValue,
          modifyUser.condition,
          modifyUser.conditionValue
        );
      });
      res.status(200).json({ message: "Transaction completed successfully" });
    } catch (error) {
      console.error("Transaction error:", error);
      res.status(500).json({ error: error.message || "Transaction failed" });
    }
  }
);

app.listen(port, async () => {
  await dbManager.connect();
  console.log(`Server running at http://localhost:${port}/`);
});

process.on("SIGINT", async () => {
  await dbManager.disconnect();
  process.exit();
});
