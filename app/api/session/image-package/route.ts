import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const API_VERSION = "1.0.3";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ImagePackage = {
  finalImagePrompt?: string;
  qrcodePolicy?: string;
  portraitPolicy?: string;
  failsafePolicy?: string;
};

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const sessionId = body?.sessionId;
    const imagePackage: ImagePackage = body?.imagePackage;

    if (!sessionId) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          version: API_VERSION,
          error: "Missing sessionId",
        },
        { status: 400 }
      );
    }

    if (!isValidUuid(sessionId)) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          version: API_VERSION,
          error: "INVALID_SESSION_ID",
          message: "sessionId must be a valid UUID.",
        },
        { status: 400 }
      );
    }

    if (!imagePackage || typeof imagePackage !== "object") {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          version: API_VERSION,
          error: "Missing imagePackage",
        },
        { status: 400 }
      );
    }

    if (
      !imagePackage.finalImagePrompt ||
      typeof imagePackage.finalImagePrompt !== "string"
    ) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          version: API_VERSION,
          error: "Missing imagePackage.finalImagePrompt",
        },
        { status: 400 }
      );
    }

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .select("id, current_stage")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          version: API_VERSION,
          error: "Session not found",
          detail: sessionError?.message,
        },
        { status: 404 }
      );
    }

    if (session.current_stage !== "FINAL_IMAGE_PROMPT") {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          version: API_VERSION,
          error: "INVALID_STAGE",
          message: `Current stage is ${session.current_stage}, expected FINAL_IMAGE_PROMPT.`,
          nextAction: "loadStageRules",
          mustCallNext: "loadStageRules",
          requiredStage: "final_image_prompt",
        },
        { status: 409 }
      );
    }

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
          success: false,
          version: API_VERSION,
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
          success: false,
          version: API_VERSION,
          error: "STYLE_SELECTION_NOT_FOUND",
          message: "Style selection not found. Please call selectImageStyle first.",
          nextAction: "selectImageStyle",
          mustCallNext: "selectImageStyle",
          requiredStage: "STYLE_SELECTION",
        },
        { status: 409 }
      );
    }

    if (!existingImagePackage.selected_style) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          version: API_VERSION,
          error: "SELECTED_STYLE_MISSING",
          message: "selected_style is missing. Please call selectImageStyle first.",
          nextAction: "selectImageStyle",
          mustCallNext: "selectImageStyle",
          requiredStage: "STYLE_SELECTION",
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const nextStage = "IMAGE_GENERATION_READY";

    const imagePackagePayload = {
      final_image_prompt: imagePackage.finalImagePrompt,
      qrcode_policy: imagePackage.qrcodePolicy ?? null,
      portrait_policy: imagePackage.portraitPolicy ?? null,
      failsafe_policy: imagePackage.failsafePolicy ?? null,
      updated_at: now,
    };

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
          success: false,
          version: API_VERSION,
          error: "Failed to update image package",
          detail: updateImagePackageError.message,
        },
        { status: 500 }
      );
    }

    const { error: updateSessionError } = await supabaseAdmin
      .from("sessions")
      .update({
        current_stage: nextStage,
        updated_at: now,
      })
      .eq("id", sessionId);

    if (updateSessionError) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          version: API_VERSION,
          error: "Failed to update session stage",
          detail: updateSessionError.message,
        },
        { status: 500 }
      );
    }

    const { error: logError } = await supabaseAdmin.from("session_logs").insert({
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
          success: false,
          version: API_VERSION,
          error: "Image package saved, but failed to write session log",
          detail: logError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      success: true,
      version: API_VERSION,
      nextStage,
      imagePackage: savedImagePackage,
      nextAction: "loadStageRules",
      mustCallNext: "loadStageRules",
      requiredStage: "image_generation_failsafe",
      message:
        "Image package saved. The next action must be loadStageRules(stage = image_generation_failsafe) before image generation.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        version: API_VERSION,
        error: "Unexpected error",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
