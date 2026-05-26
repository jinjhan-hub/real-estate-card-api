import { supabaseAdmin } from "@/lib/supabaseAdmin";

type MaterialStatusBody = {
  sessionId?: string;
  materials?: {
    propertyPhotosCount?: number;
    hasBusinessCard?: boolean;
    hasPortrait?: boolean;
    hasQrcode?: boolean;
    hasOtherMaterials?: boolean;
  };
};

function jsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MaterialStatusBody;

    const sessionId = body.sessionId?.trim();
    const materials = body.materials;

    if (!sessionId) {
      return jsonResponse(
        {
          ok: false,
          error: "MISSING_SESSION_ID",
          message: "請提供 sessionId。",
        },
        { status: 400 }
      );
    }

    if (!materials) {
      return jsonResponse(
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
      return jsonResponse(
        {
          ok: false,
          error: "SESSION_NOT_FOUND",
          message: "查無此 session。",
        },
        { status: 404 }
      );
    }

    /**
     * 流程鎖：
     * 此 API 只能在 MATERIAL_STATUS 階段執行。
     * 避免 GPTs 跳步或重複錯推階段。
     */
    if (session.current_stage !== "MATERIAL_STATUS") {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "STAGE_MISMATCH",
          message: `目前 session 階段為 ${session.current_stage}，不能執行 updateMaterialStatus。`,
          sessionId,
          currentStage: session.current_stage,
          requiredStage: "MATERIAL_STATUS",
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
        },
        { status: 409 }
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
      has_other_materials: materials.hasOtherMaterials === true,
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
      return jsonResponse(
        {
          ok: false,
          error: "MATERIAL_STATUS_SAVE_FAILED",
          message: "素材狀態儲存失敗。",
          detail: saveError?.message,
        },
        { status: 500 }
      );
    }

    const nextStage = "PROPERTY_CONFIRMATION";

    const { error: updateSessionError } = await supabaseAdmin
      .from("sessions")
      .update({
        current_stage: nextStage,
      })
      .eq("id", sessionId);

    if (updateSessionError) {
      return jsonResponse(
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
      return jsonResponse(
        {
          ok: false,
          error: "SESSION_LOG_CREATE_FAILED",
          message: "建立 session log 失敗。",
          detail: logError.message,
        },
        { status: 500 }
      );
    }

    return jsonResponse({
      ok: true,
      success: true,
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
        hasOtherMaterials: savedStatus.has_other_materials,
      },
      currentStage: nextStage,
      nextStage,
      nextAction: "loadStageRules",
      mustCallNext: "loadStageRules",
      nextInstruction:
        "素材狀態已記錄。下一步必須呼叫 loadStageRules，stage = property_confirmation。",
      message:
        "素材狀態已記錄。系統僅儲存文字狀態，不儲存圖片、PDF、QR Code 或人物照。",
    });
  } catch (error) {
    return jsonResponse(
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
