import { Router, type IRouter } from "express";
import adminRouter from "./admin";
import chipScansRouter from "./chipScans";
import healthRouter from "./health";
import playersRouter from "./players";
import reservationsRouter from "./reservations";
import sessionsRouter from "./sessions";
import telegramRouter from "./telegram";
import telegramWebhookRouter from "./telegramWebhook";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminRouter);
router.use(chipScansRouter);
router.use(playersRouter);
router.use(reservationsRouter);
router.use(sessionsRouter);
router.use(telegramRouter);
router.use(telegramWebhookRouter);

export default router;
