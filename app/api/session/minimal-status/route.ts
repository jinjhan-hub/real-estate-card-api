import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = body?.sessionId ?? null;

    if (!sessionId || typeof sessionId !== "string") {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          sessionId: null,
          currentStage: null,
          nextStage: null,
          completed: false,
          message: "Missing sessionId.",
          error: "MISSING_SESSION_ID",
        },
        400
      );
    }

    const { data: session, error } = await supabaseAdmin
      .from("sessions")
      .select("id, current_stage, completed_at")
      .eq("id", sessionId)
      .single();

    if (error || !session) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          sessionId,
          currentStage: null,
          nextStage: null,
          completed: false,
          message: error?.message ?? "Session not found.",
          error: "SESSION_NOT_FOUND",
        },
        404
      );
    }

    const currentStage = session.current_stage ?? null;
    const completed = Boolean(session.completed_at);

    return jsonResponse({
      ok: true,
      success: true,
      blocked: completed,
      sessionId: session.id,
      currentStage,
      nextStage: currentStage,
      completed,
      message: completed
        ? "Session already completed."
        : "Minimal session status loaded.",
      error: null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown minimal status error.";

    return jsonResponse(
      {
        ok: false,
        success: false,
        blocked: true,
        sessionId: null,
        currentStage: null,
        nextStage: null,
        completed: false,
        message,
        error: "MINIMAL_STATUS_ERROR",
      },
      500
    );
  }
}
