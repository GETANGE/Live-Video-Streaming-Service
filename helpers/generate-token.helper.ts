import jwt from "jsonwebtoken";
import crypto from "crypto";
import type { TokenPayload } from "@types";



export function generateToken(payload: TokenPayload): string {
  const secret = process.env.JWT_SECRET || "default_secret";
  const accessToken = jwt.sign(payload, secret, { expiresIn: "1h" });
  return accessToken;
}

export function generateRefreshToken(payload: TokenPayload): string {
  const secret = process.env.JWT_SECRET || "default_secret";
  const refreshToken = jwt.sign(payload, secret, { expiresIn: "7d" });
  return refreshToken;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "default_secret");
    return decoded as TokenPayload;
  } catch (error) {
    return null;
  }
}