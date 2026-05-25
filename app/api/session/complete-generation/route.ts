import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenerationResult = {
  provider?: string;
  imageCount?: number;
  outputPaths?: string[];
  note?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const sessionId = body?.sessionId;
    const generationResult: GenerationResult | undefined = body?.generationResult;

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { ok: false, error: "Missing sessionId" },
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
          error: "Session not found",
          detail: sessionError?.message,
        },
        { status: 404 }
      );
    }

    // 2. 檢查流程階段
    if (session.current_stage !== "IMAGE_GENERATION_READY") {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid stage. Current stage is ${session.current_stage}, expected IMAGE_GENERATION_READY.`,
        },
        { status: 409 }
      );
    }

    // 3. 確認 image package 存在
    const { data: existingImagePackage, error: imagePackageError } =
      await supabaseAdmin
        .from("session_image_packages")
        .select("id, session_id, selected_style, final_image_prompt, generated_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (imagePackageError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to check image package",
          detail: imagePackageError.message,
        },
        { status: 500 }
      );
    }

    if (!existingImagePackage) {
      return NextResponse.json(
        {
          ok: false,
          error: "Image package not found",
        },
        { status: 404 }
      );
    }

    if (!existingImagePackage.final_image_prompt) {
      return NextResponse.json(
        {
          ok: false,
          error: "final_image_prompt is missing. Please complete image-package first.",
        },
        { status: 409 }
      );
    }

    if (existingImagePackage.generated_at) {
      return NextResponse.json(
        {
          ok: false,
          error: "Generation already completed for this session.",
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const nextStage = "COMPLETED";

    // 4. 更新 session_image_packages.generated_at
    const { data: savedImagePackage, error: updateImagePackageError } =
      await supabaseAdmin
        .from("session_image_packages")
        .update({
          generated_at: now,
          updated_at: now,
        })
        .eq("id", existingImagePackage.id)
        .select()
        .single();

    if (updateImagePackageError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to update image package generated_at",
          detail: updateImagePackageError.message,
        },
        { status: 500 }
      );
    }

    // 5. 更新 sessions 為 COMPLETED
    const { error: updateSessionError } = await supabaseAdmin
      .from("sessions")
      .update({
        current_stage: nextStage,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", sessionId);

    if (updateSessionError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to update session stage",
          detail: updateSessionError.message,
        },
        { status: 500 }
      );
    }

    // 6. 寫入 session_logs
    const { error: logError } = await supabaseAdmin
      .from("session_logs")
      .insert({
        session_id: sessionId,
        stage: nextStage,
        event_type: "IMAGE_GENERATION_COMPLETED",
        message: `Image generation completed. nextStage=${nextStage}`,
        metadata: {
          imagePackageId: savedImagePackage.id,
          previousStage: session.current_stage,
          nextStage,
          selectedStyle: savedImagePackage.selected_style,
          generationResult: generationResult ?? null,
        },
      });

    if (logError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Generation completed, but failed to write session log",
          detail: logError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      nextStage,
      imagePackage: savedImagePackage,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unexpected error",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}