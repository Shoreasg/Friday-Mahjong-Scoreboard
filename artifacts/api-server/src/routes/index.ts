import { Router, type IRouter } from "express";
import chipScansRouter from "./chipScans";
import healthRouter from "./health";
import playersRouter from "./players";
import sessionsRouter from "./sessions";
import telegramRouter from "./telegram";
import telegramWebhookRouter from "./telegramWebhook";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chipScansRouter);
router.use(playersRouter);
router.use(sessionsRouter);
router.use(telegramRouter);
router.use(telegramWebhookRouter);

export default router;
