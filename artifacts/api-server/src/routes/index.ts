import { Router, type IRouter } from "express";
import chipScansRouter from "./chipScans";
import healthRouter from "./health";
import playersRouter from "./players";
import sessionsRouter from "./sessions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chipScansRouter);
router.use(playersRouter);
router.use(sessionsRouter);

export default router;
