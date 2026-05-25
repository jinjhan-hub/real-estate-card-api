import { supabaseAdmin } from "@/lib/supabaseAdmin";

type MaterialStatusBody = {
  sessionId?: string;
  materials?: {
    propertyPhotosCount?: number;
    hasBusinessCard?: boolean;
    hasPortrait?: boolean;
    hasQrcode?: boolean;
  };
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MaterialStatusBody;

    const sessionId = body.sessionId?.trim();
    const materials = body.materials;

    if (!sessionId) {
      return Response.json(
        {
          ok: false,
          error: "MISSING_SESSION_ID",
          message: "請提供 sessionId。",
        },
        { status: 400 }
      );
    }

    if (!materials) {
      return Response.json(
        {
          ok: false,
          error: "MISSING_MATERIALS",
          message: "請提供 materials 素材狀態。",
        },
        { status: 400 }
      );
    }

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return Response.json(
        {
          ok: false,
          error: "SESSION_NOT_FOUND",
          message: "查無此 session。",
        },
        { status: 404 }
      );
    }

    const propertyPhotosCount = Number.isFinite(materials.propertyPhotosCount)
      ? Math.max(0, Math.floor(materials.propertyPhotosCount as number))
      : 0;

    const materialPayload = {
      session_id: sessionId,
      property_photos_count: propertyPhotosCount,
      has_business_card: materials.hasBusinessCard === true,
      has_portrait: materials.hasPortrait === true,
      has_qrcode: materials.hasQrcode === true,
    };

    const { data: existingStatus } = await supabaseAdmin
      .from("session_material_status")
      .select("id")
      .eq("session_id", sessionId)
      .maybeSingle();

    let savedStatus;
    let saveError;

    if (existingStatus?.id) {
      const result = await supabaseAdmin
        .from("session_material_status")
        .update(materialPayload)
        .eq("id", existingStatus.id)
        .select("*")
        .single();

      savedStatus = result.data;
      saveError = result.error;
    } else {
      const result = await supabaseAdmin
        .from("session_material_status")
        .insert(materialPayload)
        .select("*")
        .single();

      savedStatus = result.data;
      saveError = result.error;
    }

    if (saveError || !savedStatus) {
      return Response.json(
        {
          ok: false,
          error: "MATERIAL_STATUS_SAVE_FAILED",
          message: "素材狀態儲存失敗。",
          detail: saveError?.message,
        },
        { status: 500 }
      );
    }

    const nextStage = "DATA_EXTRACTION";

    const { error: updateSessionError } = await supabaseAdmin
      .from("sessions")
      .update({
        current_stage: nextStage,
      })
      .eq("id", sessionId);

    if (updateSessionError) {
      return Response.json(
        {
          ok: false,
          error: "SESSION_STAGE_UPDATE_FAILED",
          message: "更新 session 階段失敗。",
          detail: updateSessionError.message,
        },
        { status: 500 }
      );
    }

    const { error: logError } = await supabaseAdmin.from("session_logs").insert({
      session_id: sessionId,
      event_type: "MATERIAL_STATUS_SAVED",
      stage: nextStage,
      message: "素材狀態已記錄，未儲存任何圖片或非文字素材。",
    });

    if (logError) {
      return Response.json(
        {
          ok: false,
          error: "SESSION_LOG_CREATE_FAILED",
          message: "建立 session log 失敗。",
          detail: logError.message,
        },
        { status: 500 }
      );
    }

    return Response.json({
      ok: true,
      session: {
        id: sessionId,
        currentStage: nextStage,
      },
      materialStatus: {
        id: savedStatus.id,
        sessionId: savedStatus.session_id,
        propertyPhotosCount: savedStatus.property_photos_count,
        hasBusinessCard: savedStatus.has_business_card,
        hasPortrait: savedStatus.has_portrait,
        hasQrcode: savedStatus.has_qrcode,
      },
      nextStage,
      message: "素材狀態已記錄。系統僅儲存文字狀態，不儲存圖片、PDF、QR Code 或人物照。",
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "INTERNAL_SERVER_ERROR",
        message: "伺服器發生錯誤。",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}