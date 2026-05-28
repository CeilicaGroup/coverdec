import { z } from "zod";

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const startAttendanceSchema = z.object({
  notes: z.string().max(500).optional(),
});

export const stopAttendanceSchema = z.object({
  sessionId: z.string().min(1).optional(),
  notes: z.string().max(500).optional(),
});

export const attendanceRangeSchema = z.object({
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  personId: z.string().min(1).optional(),
});

export const adminUpsertAttendanceSchema = z
  .object({
    personId: z.string().min(1),
    date: isoDateSchema,
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    notes: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.endTime <= data.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "La hora fin debe ser posterior a la hora inicio.",
      });
    }
  });

export const adminDeleteAttendanceSchema = z.object({
  sessionId: z.string().min(1),
});
