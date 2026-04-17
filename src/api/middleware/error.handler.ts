import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error("Error:", err);

  res.status(500).json({
    error: err.message || "Internal server error",
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: "Route not found",
  });
}
