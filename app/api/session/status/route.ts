import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = body?.sessionId;

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing sessionId" },
        { status: 400 }
      );
    }

    // 1. 查 session
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .select(
        "id, store_id, current_stage, status, verified_at, completed_at, created_at, updated_at"
      )
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

    // 2. 查店家資料
    const { data: store, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("*")
      .eq("store_id", session.store_id)
      .maybeSingle();

    if (storeError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to load store data",
          detail: storeError.message,
        },
        { status: 500 }
      );
    }

    // 3. 查素材狀態
    const { data: materialStatus, error: materialStatusError } =
      await supabaseAdmin
        .from("session_material_status")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();

    if (materialStatusError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to load material status",
          detail: materialStatusError.message,
        },
        { status: 500 }
      );
    }

    // 4. 查物件資料
    const { data: propertyData, error: propertyDataError } =
      await supabaseAdmin
        .from("session_property_data")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();

    if (propertyDataError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to load property data",
          detail: propertyDataError.message,
        },
        { status: 500 }
      );
    }

    // 5. 查合規 / 文案結果
    const { data: copyResult, error: copyResultError } = await supabaseAdmin
      .from("session_copy_results")
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (copyResultError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to load copy result",
          detail: copyResultError.message,
        },
        { status: 500 }
      );
    }

    // 6. 查圖片生成文字包
    const { data: imagePackage, error: imagePackageError } =
      await supabaseAdmin
        .from("session_image_packages")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();

    if (imagePackageError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to load image package",
          detail: imagePackageError.message,
        },
        { status: 500 }
      );
    }

    // 7. 查最近流程紀錄
    const { data: logs, error: logsError } = await supabaseAdmin
      .from("session_logs")
      .select("id, session_id, stage, event_type, message, metadata, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (logsError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to load session logs",
          detail: logsError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      session,
      store,
      materialStatus,
      propertyData,
      copyResult,
      imagePackage,
      logs,
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