import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = body?.sessionId;

    if (!sessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing sessionId",
        },
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

    // 2. 確認 property data 存在
    const { data: propertyData, error: propertyDataError } =
      await supabaseAdmin
        .from("session_property_data")
        .select("id, session_id, confirmed")
        .eq("session_id", sessionId)
        .maybeSingle();

    if (propertyDataError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to check property data",
          detail: propertyDataError.message,
        },
        { status: 500 }
      );
    }

    if (!propertyData) {
      return NextResponse.json(
        {
          ok: false,
          error: "Property data not found. Please save property data first.",
        },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    // 3. 更新 session_property_data.confirmed
    const { data: confirmedPropertyData, error: confirmError } =
      await supabaseAdmin
        .from("session_property_data")
        .update({
          confirmed: true,
          confirmed_at: now,
          updated_at: now,
        })
        .eq("id", propertyData.id)
        .select()
        .single();

    if (confirmError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to confirm property data",
          detail: confirmError.message,
        },
        { status: 500 }
      );
    }

    // 4. 更新 sessions.current_stage
    const { error: updateSessionError } = await supabaseAdmin
      .from("sessions")
      .update({
        current_stage: "COMPLIANCE_CHECK",
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
        stage: "COMPLIANCE_CHECK",
        event_type: "PROPERTY_DATA_CONFIRMED",
        message: "Property data confirmed and session moved to COMPLIANCE_CHECK",
        metadata: {
          propertyDataId: confirmedPropertyData.id,
          previousStage: session.current_stage,
          nextStage: "COMPLIANCE_CHECK",
        },
      });

    if (logError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Property data confirmed, but failed to write session log",
          detail: logError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      nextStage: "COMPLIANCE_CHECK",
      propertyData: confirmedPropertyData,
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