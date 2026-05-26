import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenerateImageBody = {
  sessionId?: string;
  mode?: "mock" | "manual";
};

const REQUIRED_STAGE = "IMAGE_GENERATION_READY";

function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateImageBody;

    const sessionId = body.sessionId?.trim();
    const mode = body.mode ?? "mock";

    if (!sessionId) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "MISSING_SESSION_ID",
          message: "sessionId is required before generating image.",
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
        },
        400
      );
    }

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "SESSION_NOT_FOUND",
          message: "Session not found.",
          sessionId,
          nextAction: "startSession",
          mustCallNext: "startSession",
        },
        404
      );
    }

    const currentStage = session.current_stage;

    if (currentStage !== REQUIRED_STAGE) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "INVALID_STAGE",
          message: `Invalid stage. Current stage is ${currentStage}, expected ${REQUIRED_STAGE}.`,
          sessionId,
          currentStage,
          requiredStage: REQUIRED_STAGE,
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
        },
        409
      );
    }

    const { data: imagePackage, error: imagePackageError } =
      await supabaseAdmin
        .from("session_image_packages")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();

    const warnings: string[] = [];

    if (imagePackageError) {
      warnings.push(`session_image_packages 查詢錯誤：${imagePackageError.message}`);
    }

    if (!imagePackage) {
      warnings.push(
        "找不到 session_image_packages row；本次 generateImage 以 mock 模式繼續，用於流程閉環測試。"
      );
    }

    if (imagePackage) {
      const missingFields: string[] = [];

      if (!imagePackage.selected_style) missingFields.push("selected_style");
      if (!imagePackage.final_image_prompt) missingFields.push("final_image_prompt");
      if (!imagePackage.qrcode_policy) missingFields.push("qrcode_policy");
      if (!imagePackage.portrait_policy) missingFields.push("portrait_policy");
      if (!imagePackage.failsafe_policy) missingFields.push("failsafe_policy");

      if (missingFields.length > 0) {
        return jsonResponse(
          {
            ok: false,
            success: false,
            blocked: true,
            error: "INCOMPLETE_IMAGE_PACKAGE",
            message: `Image package is incomplete. Missing fields: ${missingFields.join(
              ", "
            )}.`,
            sessionId,
            currentStage,
            missingFields,
            nextAction: "getSessionStatus",
            mustCallNext: "getSessionStatus",
          },
          409
        );
      }
    }

    const generatedImageUrl =
      mode === "mock"
        ? "/mnt/data/mock-real-estate-card.png"
        : "/mnt/data/manual-real-estate-card.png";

    const generationResult = {
      success: true,
      imageCount: 1,
      outputPaths: [generatedImageUrl],
      generatedImageUrl,
      checked: true,
      passed: true,
      mode,
      mock: mode === "mock",
      notes:
        warnings.length > 0
          ? warnings.join(" ")
          : "Image generation result prepared successfully.",
    };

    return jsonResponse({
      ok: true,
      success: true,
      blocked: false,
      sessionId,
      currentStage,
      nextStage: currentStage,
      nextAction: "completeGeneration",
      mustCallNext: "completeGeneration",
      imageGenerated: true,
      image_generated: true,
      generatedImageUrl,
      generated_image_url: generatedImageUrl,
      outputPaths: [generatedImageUrl],
      generationResult,
      warnings,
      message:
        mode === "mock"
          ? "Mock image generation completed. Ready to call completeGeneration."
          : "Manual image generation result prepared. Ready to call completeGeneration.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return jsonResponse(
      {
        ok: false,
        success: false,
        blocked: true,
        error: "GENERATE_IMAGE_FAILED",
        message,
        nextAction: "getSessionStatus",
        mustCallNext: "getSessionStatus",
      },
      500
    );
  }
}
