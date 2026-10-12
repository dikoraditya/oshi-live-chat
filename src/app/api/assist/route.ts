import { NextResponse } from "next/server";

import { assist, AssistError } from "@/lib/assist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    jp?: string;
    history?: string[];
    nickname?: string;
  } | null;

  if (!body?.jp || typeof body.jp !== "string") {
    return NextResponse.json({ error: "jp is required." }, { status: 400 });
  }

  try {
    const result = await assist({
      jp: body.jp,
      history: Array.isArray(body.history) ? body.history : undefined,
      nickname: typeof body.nickname === "string" ? body.nickname : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof AssistError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Assist failed.";
    return NextResponse.json({ error: message }, { status });
  }
}
