import cors from "cors";

export const corsOptions: cors.CorsOptions = {
  origin: true,
  methods: ["GET", "POST", "DELETE", "PATCH", "PUT"],
  allowedHeaders: ["Content-type", "Authorization", "Accept-version"],
  exposedHeaders: ["Content-Range", "X-Total-Count"],
  credentials: true,
  maxAge: 600,
  preflightContinue: false,
  optionsSuccessStatus: 204,
};
