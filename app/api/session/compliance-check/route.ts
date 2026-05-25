import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ComplianceResult = {
  passed: boolean;
  notes?: {
    missingItems?: string[];
    warnings?: string[];
    prohibitedTerms?: string[];
    suggestions?: string[];
    summary?: string;
  };
  cardTitle?: string;
  cardSubtitle?: string;
  sellingPoints?: string[];
  ctaText?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const sessionId = body?.sessionId;
    const complianceResult: ComplianceResult = body?.complianceResult;

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing sessionId" },
        { status: 400 }
      );
    }

    if (!complianceResult || typeof complianceResult !== "object") {
      return NextResponse.json(
        { ok: false, error: "Missing complianceResult" },
        { status: 400 }
      );
    }

    if (typeof complianceResult.passed !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "complianceResult.passed must be boolean" },
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

    // 2. 確認 property data 已經被使用者確認
    const { data: propertyData, error: propertyDataError } =
      await supabaseAdmin
        .from("session_property_data")
        .select("id, confirmed")
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

    if (propertyData.confirmed !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: "Property data has not been confirmed by user.",
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();

    const nextStage = complianceResult.passed
      ? "STYLE_SELECTION"
      : "USER_CONFIRMATION";

    const copyPayload = {
      session_id: sessionId,
      card_title: complianceResult.cardTitle ?? null,
      card_subtitle: complianceResult.cardSubtitle ?? null,
      selling_points: complianceResult.sellingPoints ?? [],
      cta_text: complianceResult.ctaText ?? null,
      compliance_passed: complianceResult.passed,
      compliance_notes: complianceResult.notes ?? {},
      updated_at: now,
    };

    // 3. 檢查 session_copy_results 是否已有資料
    const { data: existingCopyResult, error: existingError } =
      await supabaseAdmin
        .from("session_copy_results")
        .select("id")
        .eq("session_id", sessionId)
        .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to check existing copy result",
          detail: existingError.message,
        },
        { status: 500 }
      );
    }

    let savedCopyResult;

    if (existingCopyResult?.id) {
      const { data, error } = await supabaseAdmin
        .from("session_copy_results")
        .update(copyPayload)
        .eq("id", existingCopyResult.id)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          {
            ok: false,
            error: "Failed to update compliance result",
            detail: error.message,
          },
          { status: 500 }
        );
      }

      savedCopyResult = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("session_copy_results")
        .insert(copyPayload)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          {
            ok: false,
            error: "Failed to insert compliance result",
            detail: error.message,
          },
          { status: 500 }
        );
      }

      savedCopyResult = data;
    }

    // 4. 更新 session stage
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
        event_type: "COMPLIANCE_CHECK_SAVED",
        message: `Compliance check saved. passed=${complianceResult.passed}, nextStage=${nextStage}`,
        metadata: {
          copyResultId: savedCopyResult.id,
          previousStage: session.current_stage,
          nextStage,
          compliancePassed: complianceResult.passed,
        },
      });

    if (logError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Compliance result saved, but failed to write session log",
          detail: logError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      nextStage,
      compliancePassed: complianceResult.passed,
      copyResult: savedCopyResult,
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