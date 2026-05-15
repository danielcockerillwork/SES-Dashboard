import { NextResponse } from "next/server";
import { requireCurrentUserId, unauthorizedResponse } from "@/lib/auth";
import { getConservaAppointmentDetail } from "@/lib/serviceminder/reporting";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ appointmentId: string }>;
};

export async function GET(_request: Request, context: Context) {
  const userId = await requireCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const { appointmentId } = await context.params;
  if (!appointmentId.trim()) {
    return NextResponse.json({ error: "Appointment id is required." }, { status: 400 });
  }

  const row = await getConservaAppointmentDetail(userId, appointmentId);
  if (!row) return NextResponse.json({ error: "Appointment not found." }, { status: 404 });

  return NextResponse.json({ row: { ...row, raw: undefined } });
}
