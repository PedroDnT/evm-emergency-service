import { Router } from "express";
import { RescueController } from "../controllers/rescue.controller";

export function createRescueRoutes(controller: RescueController): Router {
  const router = Router();

  router.post("/estimate", controller.estimate);
  router.post("/params", controller.getParams);
  router.post("/execute", controller.execute);
  router.get("/status/:rescueId", controller.getStatus);

  return router;
}
