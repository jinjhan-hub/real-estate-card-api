import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type StyleSelectionBody = {
  sessionId?: string;
  selectedStyle?: string;
};

export async function POST(request: Request) {
  try {
    const body: StyleSelectionBody = await request.json();

    const sessionId = body?.sessionId;
    const selectedStyle = body?.selectedStyle;

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing sessionId" },
        { status: 400 }
      );
    }

    if (!selectedStyle || typeof selectedStyle !== "string") {
      return NextResponse.json(
        { ok: false, error: "Missing selectedStyle" },
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

    // 2. 確認合規已通過
    const { data: copyResult, error: copyResultError } = await supabaseAdmin
      .from("session_copy_results")
      .select("id, compliance_passed")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (copyResultError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to check compliance result",
          detail: copyResultError.message,
        },
        { status: 500 }
      );
    }

    if (!copyResult) {
      return NextResponse.json(
        {
          ok: false,
          error: "Compliance result not found. Please run compliance check first.",
        },
        { status: 404 }
      );
    }

    if (copyResult.compliance_passed !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: "Compliance check has not passed. Cannot proceed to image generation.",
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const nextStage = "IMAGE_GENERATION_READY";

    const imagePackagePayload = {
      session_id: sessionId,
      selected_style: selectedStyle,
      updated_at: now,
    };

    // 3. 檢查 session_image_packages 是否已有資料
    const { data: existingImagePackage, error: existingError } =
      await supabaseAdmin
        .from("session_image_packages")
        .select("id")
        .eq("session_id", sessionId)
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

    let savedImagePackage;

    if (existingImagePackage?.id) {
      const { data, error } = await supabaseAdmin
        .from("session_image_packages")
        .update(imagePackagePayload)
        .eq("id", existingImagePackage.id)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          {
            ok: false,
            error: "Failed to update style selection",
            detail: error.message,
          },
          { status: 500 }
        );
      }

      savedImagePackage = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("session_image_packages")
        .insert(imagePackagePayload)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          {
            ok: false,
            error: "Failed to insert style selection",
            detail: error.message,
          },
          { status: 500 }
        );
      }

      savedImagePackage = data;
    }

    // 4. 更新 sessions.current_stage
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
        event_type: "STYLE_SELECTED",
        message: `Style selected. selectedStyle=${selectedStyle}, nextStage=${nextStage}`,
        metadata: {
          imagePackageId: savedImagePackage.id,
          previousStage: session.current_stage,
          nextStage,
          selectedStyle,
        },
      });

    if (logError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Style selected, but failed to write session log",
          detail: logError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      nextStage,
      selectedStyle,
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