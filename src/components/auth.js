import jwt from "jsonwebtoken";
import fs from "fs";

const roles = JSON.parse(fs.readFileSync("./src/roles.json", "utf-8"));

// Middleware to verify JWT
export function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  jwt.verify(token, process.env.SECRET_KEY, (err, user) => {
    if (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Unauthorized: Token expired" });
      }
      return res.status(403).json({ error: "Unauthorized: Invalid token" });
    }
    req.user = user;
    req.user.permissions = roles[user.role]?.permissions || [];
    next();
  });
}

export function authorize(permissions) {
  return (req, res, next) => {
    const userPermissions = req.user.permissions;
    const hasPermission = permissions.every((permission) =>
      userPermissions.includes(permission)
    );
    console.log("User permissions:", userPermissions);
    console.log("Required permissions:", permissions);
    if (!hasPermission) {
      return res
        .status(403)
        .json({ error: "Forbidden: Insufficient permissions" });
    }
    next();
  };
}

export function generateAccessToken(user, secretKey) {
  return jwt.sign(user, secretKey, { expiresIn: "15m" });
}

export function generateRefreshToken(user, secretKey) {
  return jwt.sign(user, secretKey, { expiresIn: "7d" });
}
