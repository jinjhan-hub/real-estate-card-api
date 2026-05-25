import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PropertyData = {
  title?: string;
  price?: string;
  address?: string;
  landArea?: string;
  buildingArea?: string;
  layout?: string;
  age?: string;
  parking?: string;
  highlights?: string[];
  contactData?: Record<string, unknown>;
  missingFields?: string[];
};

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const sessionId = body?.sessionId;
    const propertyData: PropertyData = body?.propertyData;

    if (!sessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing sessionId",
        },
        { status: 400 }
      );
    }

    if (!propertyData || typeof propertyData !== "object") {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing propertyData",
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

    // 2. 整理要寫入 session_property_data 的欄位
    const propertyPayload = {
      session_id: sessionId,
      title: propertyData.title ?? null,
      price: propertyData.price ?? null,
      address: propertyData.address ?? null,
      land_area: propertyData.landArea ?? null,
      building_area: propertyData.buildingArea ?? null,
      layout: propertyData.layout ?? null,
      age: propertyData.age ?? null,
      parking: propertyData.parking ?? null,
      highlights: propertyData.highlights ?? [],
      contact_data: propertyData.contactData ?? {},
      missing_fields: propertyData.missingFields ?? [],
      confirmed: false,
      confirmed_at: null,
      updated_at: new Date().toISOString(),
    };

    // 3. 先檢查這個 session 是否已經有 property data
    const { data: existingPropertyData, error: existingError } =
      await supabaseAdmin
        .from("session_property_data")
        .select("id")
        .eq("session_id", sessionId)
        .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to check existing property data",
          detail: existingError.message,
        },
        { status: 500 }
      );
    }

    let savedPropertyData;

    if (existingPropertyData?.id) {
      // 4A. 已存在 → update
      const { data, error } = await supabaseAdmin
        .from("session_property_data")
        .update(propertyPayload)
        .eq("id", existingPropertyData.id)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          {
            ok: false,
            error: "Failed to update property data",
            detail: error.message,
          },
          { status: 500 }
        );
      }

      savedPropertyData = data;
    } else {
      // 4B. 不存在 → insert
      const { data, error } = await supabaseAdmin
        .from("session_property_data")
        .insert(propertyPayload)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          {
            ok: false,
            error: "Failed to insert property data",
            detail: error.message,
          },
          { status: 500 }
        );
      }

      savedPropertyData = data;
    }

    // 5. 更新 sessions.current_stage
    const { error: updateSessionError } = await supabaseAdmin
      .from("sessions")
      .update({
        current_stage: "USER_CONFIRMATION",
        updated_at: new Date().toISOString(),
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
        event_type: "PROPERTY_DATA_SAVED",
        message: `Property data saved and session moved to USER_CONFIRMATION. propertyDataId=${savedPropertyData.id}. Next action must be confirmPropertyData.`,
      });

    if (logError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Property data saved, but failed to write session log",
          detail: logError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      nextStage: "USER_CONFIRMATION",
      nextAction: "confirmPropertyData",
      mustCallNext: "confirmPropertyData",
      message:
        "Property data saved. The next action must be confirmPropertyData before loading compliance_check rules.",
      propertyData: savedPropertyData,
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
