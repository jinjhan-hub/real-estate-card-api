import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { simpleActionResponse } from "@/lib/simple-action-response";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const sessionId = body.sessionId;
    const qrcodePolicy = body.qrcodePolicy;
    const portraitPolicy = body.portraitPolicy;
    const failsafePolicy = body.failsafePolicy;

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

    if (!qrcodePolicy || !portraitPolicy || !failsafePolicy) {
      return simpleActionResponse({
        ok: false,
        success: false,
        sessionId,
        currentStage: "",
        nextStage: "",
        nextAction: "saveImagePolicies",
        mustCallNext: "saveImagePolicies",
        requiredStage: "IMAGE_POLICIES",
        message: "qrcodePolicy, portraitPolicy and failsafePolicy are required.",
        error: "MISSING_IMAGE_POLICIES"
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

    if (currentStage !== "IMAGE_POLICIES") {
      return simpleActionResponse({
        ok: false,
        success: false,
        sessionId,
        currentStage,
        nextStage: currentStage,
        nextAction: "getSessionStatus",
        mustCallNext: "getSessionStatus",
        requiredStage: "IMAGE_POLICIES",
        message: "Current stage does not allow saving image policies.",
        error: "INVALID_STAGE"
      });
    }

    const { error: upsertError } = await supabaseAdmin
      .from("image_packages")
      .upsert(
        {
          session_id: sessionId,
          qrcode_policy: qrcodePolicy,
          portrait_policy: portraitPolicy,
          failsafe_policy: failsafePolicy,
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
        nextAction: "saveImagePolicies",
        mustCallNext: "saveImagePolicies",
        requiredStage: "IMAGE_POLICIES",
        message: "Failed to save image policies.",
        error: "SAVE_IMAGE_POLICIES_FAILED"
      });
    }

    await supabaseAdmin
      .from("sessions")
      .update({
        current_stage: "IMAGE_GENERATION_READY",
        updated_at: new Date().toISOString()
      })
      .eq("id", sessionId);

    return simpleActionResponse({
      ok: true,
      success: true,
      sessionId,
      currentStage: "IMAGE_GENERATION_READY",
      nextStage: "IMAGE_GENERATION_READY",
      nextAction: "generateImage",
      mustCallNext: "generateImage",
      requiredStage: "",
      message: "Image policies saved. Ready for image generation."
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
