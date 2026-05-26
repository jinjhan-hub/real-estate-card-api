import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sessionId, generatedImageUrl } = body;

    if (!sessionId) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "MISSING_SESSION_ID",
          message: "sessionId is required before marking image generation success.",
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
        },
        { status: 400 }
      );
    }

    if (!generatedImageUrl) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "MISSING_GENERATED_IMAGE_URL",
          message: "generatedImageUrl is required after image generation succeeds.",
          nextAction: "image_generation",
          mustCallNext: "image_generation",
        },
        { status: 400 }
      );
    }

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .select("id,current_stage")
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
          nextAction: "startSession",
          mustCallNext: "startSession",
        },
        { status: 404 }
      );
    }

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

    const { data: imagePackage, error: packageError } = await supabaseAdmin
      .from("session_image_packages")
      .update({
        image_generated: true,
        generated_image_url: generatedImageUrl,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("session_id", sessionId)
      .select("*")
      .single();

    if (packageError || !imagePackage) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "IMAGE_PACKAGE_NOT_FOUND",
          message:
            "Image package not found. Please save image package before marking generation success.",
          nextAction: "saveImagePackage",
          mustCallNext: "saveImagePackage",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      success: true,
      message: "Image generation success has been recorded.",
      session,
      imagePackage,
      nextAction: "complete-generation",
      mustCallNext: "complete-generation",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        blocked: true,
        error: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown server error.",
      },
      { status: 500 }
    );
  }
}
