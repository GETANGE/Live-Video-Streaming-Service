import cors from "cors";

const whitelist = ["http://localhost:3000", "http://frontend-live-domain.com"];

export const corsOptions: cors.CorsOptions = {
  origin: function (origin, callback) {
    if (!origin || whitelist.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "DELETE", "PATCH", "PUT"],
  allowedHeaders: ["Content-type", "Authorization", "Accept-version"],
  exposedHeaders: ["Content-Range", "X-Total-Count"],
  credentials: true,
  maxAge: 600,
  preflightContinue: false,
  optionsSuccessStatus: 204,
};
