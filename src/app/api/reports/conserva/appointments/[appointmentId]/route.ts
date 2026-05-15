import { NextResponse } from "next/server";
import { requireCurrentUserId, unauthorizedResponse } from "@/lib/auth";
import { getConservaAppointmentDetail, ServiceMinderApiKeyRequiredError } from "@/lib/serviceminder/reporting";

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

  let row;
  try {
    row = await getConservaAppointmentDetail(userId, appointmentId);
  } catch (error) {
    if (error instanceof ServiceMinderApiKeyRequiredError) {
      return NextResponse.json(
        { error: error.message, code: "serviceminder_api_key_required" },
        { status: 428 },
      );
    }

    const message = error instanceof Error ? error.message : "Appointment could not be loaded.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!row) return NextResponse.json({ error: "Appointment not found." }, { status: 404 });

  return NextResponse.json({ row: { ...row, raw: undefined } });
}
