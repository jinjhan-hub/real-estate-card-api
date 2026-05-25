import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ImagePackage = {
  finalImagePrompt?: string;
  qrcodePolicy?: string;
  portraitPolicy?: string;
  failsafePolicy?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const sessionId = body?.sessionId;
    const imagePackage: ImagePackage = body?.imagePackage;

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing sessionId" },
        { status: 400 }
      );
    }

    if (!imagePackage || typeof imagePackage !== "object") {
      return NextResponse.json(
        { ok: false, error: "Missing imagePackage" },
        { status: 400 }
      );
    }

    if (
      !imagePackage.finalImagePrompt ||
      typeof imagePackage.finalImagePrompt !== "string"
    ) {
      return NextResponse.json(
        { ok: false, error: "Missing imagePackage.finalImagePrompt" },
        { status: 400 }
      );
    }

    // 1. 確認 session 存在
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .select("id, current_stage")
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

    // 2. 確認 image package 已有 selected_style
    const { data: existingImagePackage, error: existingError } =
      await supabaseAdmin
        .from("session_image_packages")
        .select("id, selected_style")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to check existing image package",
          detail: existingError.message,
        },
        { status: 500 }
      );
    }

    if (!existingImagePackage) {
      return NextResponse.json(
        {
          ok: false,
          error: "Style selection not found. Please select style first.",
        },
        { status: 404 }
      );
    }

    if (!existingImagePackage.selected_style) {
      return NextResponse.json(
        {
          ok: false,
          error: "selected_style is missing. Please select style first.",
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const nextStage = "COMPLETED";

    const imagePackagePayload = {
      final_image_prompt: imagePackage.finalImagePrompt,
      qrcode_policy: imagePackage.qrcodePolicy ?? null,
      portrait_policy: imagePackage.portraitPolicy ?? null,
      failsafe_policy: imagePackage.failsafePolicy ?? null,
      generated_at: now,
      updated_at: now,
    };

    // 3. 更新 session_image_packages
    const { data: savedImagePackage, error: updateImagePackageError } =
      await supabaseAdmin
        .from("session_image_packages")
        .update(imagePackagePayload)
        .eq("id", existingImagePackage.id)
        .select()
        .single();

    if (updateImagePackageError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to update image package",
          detail: updateImagePackageError.message,
        },
        { status: 500 }
      );
    }

    // 4. 更新 sessions.current_stage
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

    // 5. 寫入 session_logs
    const { error: logError } = await supabaseAdmin
      .from("session_logs")
      .insert({
        session_id: sessionId,
        stage: nextStage,
        event_type: "IMAGE_PACKAGE_SAVED",
        message: `Image package saved. nextStage=${nextStage}`,
        metadata: {
          imagePackageId: savedImagePackage.id,
          previousStage: session.current_stage,
          nextStage,
          selectedStyle: savedImagePackage.selected_style,
        },
      });

    if (logError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Image package saved, but failed to write session log",
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