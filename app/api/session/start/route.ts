import { supabaseAdmin } from "@/lib/supabaseAdmin";

type StartSessionBody = {
  storeId?: string;
  code?: string;
};

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return false;

  const today = new Date();
  const expireDate = new Date(expiresAt);

  return expireDate.getTime() < today.getTime();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StartSessionBody;

    const storeId = body.storeId?.trim();
    const code = body.code?.trim();

    if (!storeId || !code) {
      return Response.json(
        {
          ok: false,
          error: "MISSING_STORE_ID_OR_CODE",
          message: "請提供 storeId 與 code。",
        },
        { status: 400 }
      );
    }

    const { data: store, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("*")
      .eq("store_id", storeId)
      .single();

    if (storeError || !store) {
      return Response.json(
        {
          ok: false,
          error: "STORE_NOT_FOUND",
          message: "查無此店家代號。",
        },
        { status: 404 }
      );
    }

    if (store.access_code !== code) {
      return Response.json(
        {
          ok: false,
          error: "INVALID_CODE",
          message: "認證碼錯誤。",
        },
        { status: 401 }
      );
    }

    if (store.active !== true) {
      return Response.json(
        {
          ok: false,
          error: "STORE_INACTIVE",
          message: "此店家目前未啟用。",
        },
        { status: 403 }
      );
    }

    if (isExpired(store.expires_at)) {
      return Response.json(
        {
          ok: false,
          error: "STORE_EXPIRED",
          message: "此店家授權已過期。",
        },
        { status: 403 }
      );
    }

    const features = Array.isArray(store.features) ? store.features : [];

    if (!features.includes("sales_card")) {
      return Response.json(
        {
          ok: false,
          error: "FEATURE_NOT_ALLOWED",
          message: "此店家尚未開通銷售圖卡功能。",
        },
        { status: 403 }
      );
    }

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .insert({
        store_id: store.store_id,
        current_stage: "MATERIAL_UPLOAD_GUIDE",
        status: "active",
      })
      .select("*")
      .single();

    if (sessionError || !session) {
      return Response.json(
        {
          ok: false,
          error: "SESSION_CREATE_FAILED",
          message: "建立 session 失敗。",
          detail: sessionError?.message,
        },
        { status: 500 }
      );
    }

const { error: logError } = await supabaseAdmin.from("session_logs").insert({
  session_id: session.id,
  event_type: "SESSION_STARTED",
  stage: "MATERIAL_UPLOAD_GUIDE",
  message: "店家認證成功，建立 session。",
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
        id: session.id,
        storeId: session.store_id,
        currentStage: session.current_stage,
        status: session.status,
        createdAt: session.created_at,
      },
      store: {
        storeId: store.store_id,
        storeName: store.store_name,
        brokerageName: store.brokerage_name,
        brokerName: store.broker_name,
        brokerLicenseNo: store.broker_license_no,
        features: store.features,
      },
      nextStage: "MATERIAL_UPLOAD_GUIDE",
      message: "店家認證成功，已自動帶入公版揭露資料。",
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