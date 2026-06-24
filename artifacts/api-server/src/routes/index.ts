import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import propertiesRouter from "./properties";
import tasksRouter from "./tasks";
import pushRouter from "./push";
import dashboardRouter from "./dashboard";
import syncRouter from "./sync";
import directoryRouter from "./directory";
import rentStatusRouter from "./rent-status";
import rentecRouter from "./rentec";
import tenantNotesRouter from "./tenant-notes";
import collectionRouter from "./collection";
import contactChecklistRouter from "./contact-checklist";
import followupRouter from "./followup";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(propertiesRouter);
router.use(tasksRouter);
router.use(pushRouter);
router.use(dashboardRouter);
router.use(syncRouter);
router.use(directoryRouter);
router.use(rentStatusRouter);
router.use(rentecRouter);
router.use(tenantNotesRouter);
router.use(collectionRouter);
router.use(contactChecklistRouter);
router.use(followupRouter);

export default router;
