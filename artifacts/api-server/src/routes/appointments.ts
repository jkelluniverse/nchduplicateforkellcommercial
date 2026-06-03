import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, appointmentsTable, jobsTable } from "@workspace/db";
import { CreateAppointmentBody, UpdateAppointmentBody, UpdateAppointmentParams, DeleteAppointmentParams } from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

function parseParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

router.get("/appointments", requireAuth, async (req, res): Promise<void> => {
  const dateFilter = req.query.date as string | undefined;

  const appointments = await db.select({
    appt: appointmentsTable,
    job: { jobNumber: jobsTable.jobNumber },
  }).from(appointmentsTable)
    .leftJoin(jobsTable, eq(appointmentsTable.linkedJobId, jobsTable.id))
    .orderBy(sql`${appointmentsTable.startTime} ASC`);

  const filtered = dateFilter
    ? appointments.filter((a) => {
        const d = new Date(a.appt.startTime);
        return d.toISOString().split("T")[0] === dateFilter;
      })
    : appointments;

  res.json(filtered.map((a) => ({
    id: a.appt.id,
    title: a.appt.title,
    startTime: a.appt.startTime,
    endTime: a.appt.endTime,
    location: a.appt.location,
    notes: a.appt.notes,
    attendees: a.appt.attendees,
    linkedJobId: a.appt.linkedJobId,
    linkedJobNumber: a.job?.jobNumber || null,
    createdBy: a.appt.createdBy,
    ownerRole: a.appt.ownerRole,
    createdAt: a.appt.createdAt,
  })));
});

router.post("/appointments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [appt] = await db.insert(appointmentsTable).values({
    title: parsed.data.title,
    startTime: new Date(parsed.data.startTime),
    endTime: parsed.data.endTime ? new Date(parsed.data.endTime) : null,
    location: parsed.data.location || null,
    notes: parsed.data.notes || null,
    attendees: parsed.data.attendees || [],
    linkedJobId: parsed.data.linkedJobId || null,
    createdBy: req.user!.username,
    ownerRole: req.user!.role as "mike" | "jack" | "jacob",
  }).returning();

  res.status(201).json({
    ...appt,
    linkedJobNumber: null,
  });
});

router.patch("/appointments/:appointmentId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = parseParam(req.params.appointmentId);
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = UpdateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.startTime) updateData.startTime = new Date(parsed.data.startTime);
  if (parsed.data.endTime) updateData.endTime = new Date(parsed.data.endTime);

  const [appt] = await db.update(appointmentsTable).set(updateData).where(eq(appointmentsTable.id, id)).returning();
  if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }

  res.json({ ...appt, linkedJobNumber: null });
});

router.delete("/appointments/:appointmentId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = parseParam(req.params.appointmentId);
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [appt] = await db.delete(appointmentsTable).where(eq(appointmentsTable.id, id)).returning();
  if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }

  res.json({ success: true });
});

export default router;
