import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { simpleActionResponse } from "@/lib/simple-action-response";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const sessionId = body.sessionId;
    const finalImagePrompt = body.finalImagePrompt;

    if (!sessionId) {
      return simpleActionResponse({
        ok: false,
        success: false,
        sessionId: "",
        currentStage: "",
        nextStage: "",
        nextAction: "getSessionStatus",
        mustCallNext: "getSessionStatus",
        requiredStage: "",
        message: "sessionId is required.",
        error: "MISSING_SESSION_ID"
      });
    }

    if (!finalImagePrompt || typeof finalImagePrompt !== "string") {
      return simpleActionResponse({
        ok: false,
        success: false,
        sessionId,
        currentStage: "",
        nextStage: "",
        nextAction: "saveFinalImagePrompt",
        mustCallNext: "saveFinalImagePrompt",
        requiredStage: "FINAL_IMAGE_PROMPT",
        message: "finalImagePrompt is required.",
        error: "MISSING_FINAL_IMAGE_PROMPT"
      });
    }

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .select("id,current_stage")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return simpleActionResponse({
        ok: false,
        success: false,
        sessionId,
        currentStage: "",
        nextStage: "",
        nextAction: "startSession",
        mustCallNext: "startSession",
        requiredStage: "",
        message: "Session not found.",
        error: "SESSION_NOT_FOUND"
      });
    }

    const currentStage = session.current_stage;

    if (currentStage !== "FINAL_IMAGE_PROMPT") {
      return simpleActionResponse({
        ok: false,
        success: false,
        sessionId,
        currentStage,
        nextStage: currentStage,
        nextAction: "getSessionStatus",
        mustCallNext: "getSessionStatus",
        requiredStage: "FINAL_IMAGE_PROMPT",
        message: "Current stage does not allow saving final image prompt.",
        error: "INVALID_STAGE"
      });
    }

    const { error: upsertError } = await supabaseAdmin
     .from("session_image_packages")
      .upsert(
        {
          session_id: sessionId,
          final_image_prompt: finalImagePrompt,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: "session_id"
        }
      );

   if (upsertError) {
  return simpleActionResponse({
    ok: false,
    success: false,
    sessionId,
    currentStage,
    nextStage: currentStage,
    nextAction: "saveFinalImagePrompt",
    mustCallNext: "saveFinalImagePrompt",
    requiredStage: "FINAL_IMAGE_PROMPT",
    message: upsertError.message,
    error: "SAVE_FINAL_IMAGE_PROMPT_FAILED"
  });
}

    await supabaseAdmin
      .from("sessions")
      .update({
        current_stage: "IMAGE_POLICIES",
        updated_at: new Date().toISOString()
      })
      .eq("id", sessionId);

    return simpleActionResponse({
      ok: true,
      success: true,
      sessionId,
      currentStage: "IMAGE_POLICIES",
      nextStage: "IMAGE_POLICIES",
      nextAction: "loadStageRules",
      mustCallNext: "loadStageRules",
      requiredStage: "image_generation_failsafe",
      message: "Final image prompt saved."
    });
  } catch {
    return simpleActionResponse({
      ok: false,
      success: false,
      sessionId: "",
      currentStage: "",
      nextStage: "",
      nextAction: "getSessionStatus",
      mustCallNext: "getSessionStatus",
      requiredStage: "",
      message: "Unexpected server error.",
      error: "SERVER_ERROR"
    });
  }
}
