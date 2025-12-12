import type { Response, Request, NextFunction } from "express";
import APIError from "@utils/APIError";
import logger from "@utils/logger";
import { Prisma } from "@configs/database.config";

// ------------------ Error Handlers ------------------

const handlePrismaError = (err: any) => {
  if (err instanceof Prisma.PrismaClientValidationError) {
    return new APIError("Invalid input data", 400);
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return new APIError(
          `Duplicate field value: ${JSON.stringify(err.meta?.target)}`,
          400
        );
      case "P2003":
        return new APIError(
          `Invalid reference in field: ${err.meta?.field_name}`,
          400
        );
      case "P2025":
        return new APIError("Record not found", 404);
    }
  }

  return err;
};

const handleDuplicateFieldDB = (err: any) => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = (err.meta?.target as string[]) || [];
    const duplicateFieldName = target.length > 0 ? target[0] : "field";
    return new APIError(
      `${duplicateFieldName} already used. Please use another ${duplicateFieldName}! 🐬`,
      400
    );
  }

  return new APIError("Duplicate field error", 400);
};

const handleValidationErrorDB = (err: any) => {
  if (err instanceof Prisma.PrismaClientValidationError) {
    return new APIError("Invalid input data. Please check your fields and types.", 400);
  }

  if (err.errors && typeof err.errors === "object") {
    const errors = Object.values(err.errors).map((el: any) => el.message);
    return new APIError(`Invalid input data. ${errors.join(". ")}`, 400);
  }

  return new APIError("Validation error", 400);
};

const handleJsonWebTokenErrorDB = () => new APIError("Invalid token. Please log in again! 😊", 401);
const handleTokenExpiredErrorDB = () => new APIError("Token expired. Please log in again! 😊", 401);

// ------------------ Production & Dev Responses ------------------

const errorProd = (err: any, res: Response) => {
  if (err.isOperational) {
    res.status(err.statusCode || 500).json({
      status: err.status ?? false,
      message: err.message,
    });
  } else {
    logger.error("Error 💥", err);
    res.status(500).json({
      status: false,
      message: "Something went wrong 😒",
    });
  }
};

const errorDev = (err: any, res: Response) => {
  res.status(err.statusCode || 500).json({
    status: err.status ?? false,
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

// ------------------ Middleware ------------------

const ErrorHandlers = (err: any, req: Request, res: Response, next: NextFunction) => {
  // Ensure defaults
  err.statusCode = err.statusCode || 500;
  err.status = err.status ?? false;
  err.isOperational = err.isOperational ?? true;

  if (process.env.NODE_ENV === "development") {
    errorDev(err, res);
  } else if (process.env.NODE_ENV === "production") {
    // Use original error object to preserve non-enumerable props
    let error = err;

    if (error.name === "CastError") error = handlePrismaError(error);
    if (error.code === 11000 && error.keyValue) error = handleDuplicateFieldDB(error);
    if (error.name === "ValidationError") error = handleValidationErrorDB(error);
    if (error.name === "JsonWebTokenError") error = handleJsonWebTokenErrorDB();
    if (error.name === "TokenExpiredError") error = handleTokenExpiredErrorDB();

    errorProd(error, res);
  }
};

export default ErrorHandlers;