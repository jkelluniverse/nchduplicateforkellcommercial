import { type Request, type Response, type NextFunction } from "express";
import { verifyToken } from "../routes/auth";

export interface AuthRequest extends Request {
  user?: { id: number; role: string; username: string };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else if (typeof req.query.token === "string" && req.query.token.length > 0) {
    // Fallback for `<img>`/`<audio>` tags that cannot send Authorization headers.
    token = req.query.token;
  }
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  req.user = decoded;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
