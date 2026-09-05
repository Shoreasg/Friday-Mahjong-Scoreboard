import { Router, type IRouter } from "express";
import chipScansRouter from "./chipScans";
import healthRouter from "./health";
import sessionsRouter from "./sessions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chipScansRouter);
router.use(sessionsRouter);

export default router;
