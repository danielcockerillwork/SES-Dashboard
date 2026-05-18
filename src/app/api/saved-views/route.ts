import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireCurrentUserId, unauthorizedResponse } from "@/lib/auth";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import { createLocalSavedView, deleteLocalSavedView, listLocalSavedViews } from "@/lib/local-store";
import { isDesktopMode } from "@/lib/runtime";

export const runtime = "nodejs";

const savedViewSchema = z.object({
  name: z.string().min(1).max(80),
  filters: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]))
    .default({}),
  columns: z.array(z.string()).default([]),
});

function databaseRequiredResponse() {
  return NextResponse.json({ error: "DATABASE_URL is required for saved report views." }, { status: 503 });
}

export async function GET() {
  const userId = await requireCurrentUserId();
  if (!userId) return unauthorizedResponse();
  if (isDesktopMode()) return NextResponse.json(await listLocalSavedViews(userId, "conserva-ses-score"));
  if (!isDatabaseConfigured()) return databaseRequiredResponse();

  const views = await getPrisma().savedReportView.findMany({
    where: { userId, reportType: "conserva-ses-score" },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(views);
}

export async function POST(request: Request) {
  const userId = await requireCurrentUserId();
  if (!userId) return unauthorizedResponse();
  if (isDesktopMode()) {
    const input = savedViewSchema.parse(await request.json());
    const view = await createLocalSavedView({
      userId,
      reportType: "conserva-ses-score",
      name: input.name,
      filters: input.filters,
      columns: input.columns,
    });
    return NextResponse.json(view);
  }
  if (!isDatabaseConfigured()) return databaseRequiredResponse();

  const input = savedViewSchema.parse(await request.json());
  const view = await getPrisma().savedReportView.create({
    data: {
      userId,
      reportType: "conserva-ses-score",
      name: input.name,
      filters: input.filters as Prisma.InputJsonObject,
      columns: input.columns as Prisma.InputJsonArray,
    },
  });

  return NextResponse.json(view);
}

export async function DELETE(request: Request) {
  const userId = await requireCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Saved view id is required." }, { status: 400 });
  if (isDesktopMode()) {
    await deleteLocalSavedView(userId, id);
    return NextResponse.json({ ok: true });
  }
  if (!isDatabaseConfigured()) return databaseRequiredResponse();

  await getPrisma().savedReportView.deleteMany({
    where: { id, userId },
  });

  return NextResponse.json({ ok: true });
}
