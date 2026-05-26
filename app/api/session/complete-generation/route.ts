import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenerationResult = {
  success?: boolean;
  provider?: string;
  imageCount?: number;
  outputPaths?: string[];
  generatedImageUrl?: string;
  note?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const sessionId = body?.sessionId;
    const generationResult: GenerationResult | undefined = body?.generationResult;

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "MISSING_SESSION_ID",
          message: "Missing sessionId.",
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
        },
        { status: 400 }
      );
    }

    // 1. 確認 session 存在
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .select("id, current_stage, completed_at")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "SESSION_NOT_FOUND",
          message: "Session not found.",
          detail: sessionError?.message,
          nextAction: "startSession",
          mustCallNext: "startSession",
        },
        { status: 404 }
      );
    }

    // 2. 檢查流程階段
    if (session.current_stage !== "IMAGE_GENERATION_READY") {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "INVALID_STAGE",
          message: `Invalid stage. Current stage is ${session.current_stage}, expected IMAGE_GENERATION_READY.`,
          currentStage: session.current_stage,
          requiredStage: "IMAGE_GENERATION_READY",
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
        },
        { status: 409 }
      );
    }

    // 3. 確認 image package 存在
    const { data: existingImagePackage, error: imagePackageError } =
      await supabaseAdmin
        .from("session_image_packages")
        .select(
          "id, session_id, selected_style, final_image_prompt, image_generated, generated_image_url, generated_at"
        )
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (imagePackageError) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "IMAGE_PACKAGE_CHECK_FAILED",
          message: "Failed to check image package.",
          detail: imagePackageError.message,
        },
        { status: 500 }
      );
    }

    if (!existingImagePackage) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "IMAGE_PACKAGE_NOT_FOUND",
          message: "Image package not found. Please complete image-package first.",
          nextAction: "saveImagePackage",
          mustCallNext: "saveImagePackage",
        },
        { status: 404 }
      );
    }

    if (!existingImagePackage.final_image_prompt) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "FINAL_IMAGE_PROMPT_MISSING",
          message: "final_image_prompt is missing. Please complete image-package first.",
          nextAction: "saveImagePackage",
          mustCallNext: "saveImagePackage",
        },
        { status: 409 }
      );
    }

    // 4. 防止重複完成
    if (
      existingImagePackage.image_generated === true &&
      existingImagePackage.generated_image_url
    ) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "GENERATION_ALREADY_COMPLETED",
          message: "Generation already completed for this session.",
          currentStage: session.current_stage,
        },
        { status: 409 }
      );
    }

    // 5. 關鍵防呆：沒有圖片生成成功資料，不准 complete-generation
    const outputPaths = Array.isArray(generationResult?.outputPaths)
      ? generationResult.outputPaths.filter(
          (item) => typeof item === "string" && item.trim().length > 0
        )
      : [];

    const generatedImageUrl =
      typeof generationResult?.generatedImageUrl === "string" &&
      generationResult.generatedImageUrl.trim().length > 0
        ? generationResult.generatedImageUrl.trim()
        : outputPaths[0] ?? null;

    const hasValidGenerationResult =
      generationResult?.success === true &&
      typeof generationResult.imageCount === "number" &&
      generationResult.imageCount > 0 &&
      !!generatedImageUrl;

    if (!hasValidGenerationResult) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "IMAGE_NOT_GENERATED",
          message:
            "Image has not been generated successfully yet. complete-generation requires generationResult.success=true, imageCount > 0, and at least one output path or generatedImageUrl.",
          currentStage: session.current_stage,
          requiredCondition:
            "generationResult.success=true, generationResult.imageCount > 0, generationResult.outputPaths[0] or generationResult.generatedImageUrl exists",
          nextAction: "image_generation",
          mustCallNext: "image_generation",
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const nextStage = "COMPLETED";

    // 6. 更新 session_image_packages：記錄圖片已生成
    const { data: savedImagePackage, error: updateImagePackageError } =
      await supabaseAdmin
        .from("session_image_packages")
        .update({
          image_generated: true,
          generated_image_url: generatedImageUrl,
          generated_at: now,
          updated_at: now,
        })
        .eq("id", existingImagePackage.id)
        .select()
        .single();

    if (updateImagePackageError || !savedImagePackage) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "IMAGE_PACKAGE_UPDATE_FAILED",
          message: "Failed to update image package generation fields.",
          detail: updateImagePackageError?.message,
        },
        { status: 500 }
      );
    }

    // 7. 更新 sessions 為 COMPLETED
    const { data: updatedSession, error: updateSessionError } =
      await supabaseAdmin
        .from("sessions")
        .update({
          current_stage: nextStage,
          completed_at: now,
          updated_at: now,
        })
        .eq("id", sessionId)
        .select("id, current_stage, completed_at, updated_at")
        .single();

    if (updateSessionError || !updatedSession) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "SESSION_UPDATE_FAILED",
          message: "Failed to update session stage.",
          detail: updateSessionError?.message,
        },
        { status: 500 }
      );
    }

    // 8. 寫入 session_logs
    const { error: logError } = await supabaseAdmin.from("session_logs").insert({
      session_id: sessionId,
      stage: nextStage,
      event_type: "IMAGE_GENERATION_COMPLETED",
      message: `Image generation completed. nextStage=${nextStage}`,
      metadata: {
        imagePackageId: savedImagePackage.id,
        previousStage: session.current_stage,
        nextStage,
        selectedStyle: savedImagePackage.selected_style,
        generationResult,
        generatedImageUrl,
      },
    });

    if (logError) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "SESSION_LOG_FAILED",
          message: "Generation completed, but failed to write session log.",
          detail: logError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      success: true,
      nextStage,
      session: updatedSession,
      imagePackage: savedImagePackage,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        blocked: true,
        error: "UNEXPECTED_ERROR",
        message: "Unexpected error.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
