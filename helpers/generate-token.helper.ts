import jwt from "jsonwebtoken";
import type { TokenPayload } from "@types";


export async function generateToken(payload: TokenPayload): Promise<string> {
  const secret = process.env.JWT_SECRET || "default_secret";
  const accessToken = jwt.sign(payload, secret, { expiresIn: "1h" });
  return accessToken;
}

export async function generateRefreshToken(payload: TokenPayload): Promise<string> {
  const secret = process.env.JWT_SECRET || "default_secret";
  const refreshToken = jwt.sign(payload, secret, { expiresIn: "7d" });
  return refreshToken;
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "default_secret");
    return decoded as TokenPayload;
  } catch (error) {
    return null;
  }
}