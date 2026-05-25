import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const API_VERSION = "1.0.3";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const sessionId = body?.sessionId;
    const propertyData: PropertyData = body?.propertyData;

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

    if (!propertyData || typeof propertyData !== "object") {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          version: API_VERSION,
          error: "Missing propertyData",
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

    const now = new Date().toISOString();

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
      highlights: Array.isArray(propertyData.highlights)
        ? propertyData.highlights
        : [],
      contact_data:
        propertyData.contactData && typeof propertyData.contactData === "object"
          ? propertyData.contactData
          : {},
      missing_fields: Array.isArray(propertyData.missingFields)
        ? propertyData.missingFields
        : [],
      confirmed: false,
      confirmed_at: null,
      updated_at: now,
    };

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
          success: false,
          version: API_VERSION,
          error: "Failed to check existing property data",
          detail: existingError.message,
        },
        { status: 500 }
      );
    }

    let savedPropertyData;

    if (existingPropertyData?.id) {
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
            success: false,
            version: API_VERSION,
            error: "Failed to update property data",
            detail: error.message,
          },
          { status: 500 }
        );
      }

      savedPropertyData = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("session_property_data")
        .insert(propertyPayload)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          {
            ok: false,
            success: false,
            version: API_VERSION,
            error: "Failed to insert property data",
            detail: error.message,
          },
          { status: 500 }
        );
      }

      savedPropertyData = data;
    }

    const { error: updateSessionError } = await supabaseAdmin
      .from("sessions")
      .update({
        current_stage: "USER_CONFIRMATION",
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
      stage: "USER_CONFIRMATION",
      event_type: "PROPERTY_DATA_SAVED",
      message:
        "Property data saved and session moved to USER_CONFIRMATION. Next action must be confirmPropertyData.",
      metadata: {
        propertyDataId: savedPropertyData.id,
        previousStage: session.current_stage,
        nextStage: "USER_CONFIRMATION",
        nextAction: "confirmPropertyData",
      },
    });

    if (logError) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          version: API_VERSION,
          error: "Property data saved, but failed to write session log",
          detail: logError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      success: true,
      version: API_VERSION,
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
        success: false,
        version: API_VERSION,
        error: "Unexpected error",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
