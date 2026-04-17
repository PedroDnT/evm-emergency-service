import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { RescueController } from "./controllers/rescue.controller";
import { createRescueRoutes } from "./routes/rescue.routes";
import { errorHandler, notFoundHandler } from "./middleware/error.handler";
import { rescueRateLimiter, apiRateLimiter } from "./middleware/rate-limit";

require("log-timestamp");

export function createApp(): Express {
  const app = express();

  // Configuration from environment
  const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const BASE_PRIVATE_RPC_URL = process.env.BASE_PRIVATE_RPC_URL;
  const SPONSOR_ADDRESS = process.env.SPONSOR_ADDRESS || "";
  const SERVICE_FEE_PERCENTAGE = parseFloat(process.env.SERVICE_FEE_PERCENTAGE || "5");
  const SERVICE_WALLET_ADDRESS = process.env.SERVICE_WALLET_ADDRESS || "";
  const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

  // Validate required config
  if (!SPONSOR_ADDRESS) {
    throw new Error("SPONSOR_ADDRESS environment variable is required");
  }
  if (!SERVICE_WALLET_ADDRESS) {
    throw new Error("SERVICE_WALLET_ADDRESS environment variable is required");
  }

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }));

  app.use(cors({
    origin: CORS_ORIGIN,
    credentials: true,
  }));

  // Body parsing
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Rate limiting
  app.use("/api", apiRateLimiter);

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // Initialize controllers
  const rescueController = new RescueController(
    BASE_RPC_URL,
    SPONSOR_ADDRESS,
    SERVICE_FEE_PERCENTAGE,
    SERVICE_WALLET_ADDRESS,
    BASE_PRIVATE_RPC_URL
  );

  // Routes
  app.use("/api/rescue", rescueRateLimiter, createRescueRoutes(rescueController));

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export function startServer(port: number = 3000): void {
  const app = createApp();

  app.listen(port, () => {
    console.log(`🚀 EVM Emergency Service API running on port ${port}`);
    console.log(`   Health check: http://localhost:${port}/api/health`);
    console.log(`   Environment: ${process.env.NODE_ENV || "development"}`);
  });
}

// Start server if this file is run directly
if (require.main === module) {
  const PORT = parseInt(process.env.PORT || "3000", 10);
  startServer(PORT);
}
