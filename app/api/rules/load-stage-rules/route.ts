import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const API_VERSION = "1.0.4-stage-lock";

type Stage =
  | "gpts_api_flow"
  | "material_status"
  | "property_confirmation"
  | "compliance_check"
  | "style_selection"
  | "final_image_prompt"
  | "image_generation_failsafe";

const ALLOWED_STAGES: Stage[] = [
  "gpts_api_flow",
  "material_status",
  "property_confirmation",
  "compliance_check",
  "style_selection",
  "final_image_prompt",
  "image_generation_failsafe",
];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidStage(stage: unknown): stage is Stage {
  return typeof stage === "string" && ALLOWED_STAGES.includes(stage as Stage);
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function blockResponse(params: {
  error: string;
  message: string;
  nextAction: string;
  mustCallNext: string;
  requiredStage?: string | null;
  status?: number;
}) {
  return NextResponse.json(
    {
      ok: false,
      success: false,
      blocked: true,
      version: API_VERSION,
      error: params.error,
      message: params.message,
      nextAction: params.nextAction,
      mustCallNext: params.mustCallNext,
      requiredStage: params.requiredStage ?? null,
    },
    { status: params.status ?? 409 }
  );
}

function invalidSessionIdResponse(stage: Stage) {
  return NextResponse.json(
    {
      ok: false,
      success: false,
      blocked: true,
      version: API_VERSION,
      error: "INVALID_SESSION_ID",
      message: `Invalid sessionId format before loading ${stage} rules. sessionId must be a valid UUID.`,
    },
    { status: 400 }
  );
}

function missingSessionIdResponse(stage: Stage) {
  return blockResponse({
    error: "MISSING_SESSION_ID",
    message: `sessionId is required before loading ${stage} rules.`,
    nextAction: "getSessionStatus",
    mustCallNext: "getSessionStatus",
    requiredStage: null,
  });
}

function getRuleTitle(stage: Stage): string {
  const titles: Record<Stage, string> = {
    gpts_api_flow: "GPTs API 流程主控規則",
    material_status: "素材狀態判斷規則",
    property_confirmation: "物件資料整理與確認規則",
    compliance_check: "合規檢查規則",
    style_selection: "風格選擇規則",
    final_image_prompt: "finalImagePrompt 產生規則",
    image_generation_failsafe: "圖片生成防呆規則",
  };

  return titles[stage];
}

function getRuleSummary(stage: Stage): string {
  const summaries: Record<Stage, string> = {
    gpts_api_flow:
      "規範 GPTs 串接 real-estate-card-api 的完整 session 流程，避免跳步、重跑 API、提前生成圖片或跳過 finalImagePrompt / IMAGE_GENERATION_READY。",
    material_status:
      "判斷使用者提供了哪些素材，只記錄文字狀態，不儲存圖片、PDF、QR Code、人物照、房屋照片或名片圖片本體。",
    property_confirmation:
      "整理已確認資料與待補資料。使用者明確確認前，不得寫入 propertyData，也不得呼叫 confirmPropertyData。",
    compliance_check:
      "檢查銷售圖卡資料是否有誇大、保證獲利、絕對化用語、使用未確認資料或缺少必要揭露資訊。",
    style_selection:
      "合規檢查通過後，讓使用者選擇圖卡風格。送入 API 時必須使用 OpenAPI 允許的英文風格代碼。",
    final_image_prompt:
      "依已確認物件資料、合規結果與已選風格，產生圖片生成用文字包 finalImagePrompt。",
    image_generation_failsafe:
      "圖片生成前進行最後防呆，確認人物、QR Code、房屋照片、文字資料與揭露資訊不得錯誤或變形。",
  };

  return summaries[stage];
}

function getMustFollow(stage: Stage): string[] {
  const rules: Record<Stage, string[]> = {
    gpts_api_flow: [
      "GPTs 必須依照 session stage 順序執行：STORE_VERIFY → STORE_DATA_LOADED → MATERIAL_UPLOAD_GUIDE → DATA_EXTRACTION → USER_CONFIRMATION → COMPLIANCE_CHECK → STYLE_SELECTION → FINAL_IMAGE_PROMPT → IMAGE_GENERATION_READY → COMPLETED。",
      "圖片只能在 current_stage = IMAGE_GENERATION_READY 後生成。",
      "圖片生成成功後，才可以呼叫 POST /api/session/complete-generation。",
      "使用者未明確確認物件資料前，不得呼叫 savePropertyData、confirmPropertyData、saveComplianceCheck、style-selection、image-package 或 complete-generation。",
      "DATA_EXTRACTION 階段只整理資料，不得生成圖片。",
      "COMPLIANCE_CHECK 未通過時，不得進入 STYLE_SELECTION。",
      "STYLE_SELECTION 成功後，只能進入 FINAL_IMAGE_PROMPT，不得直接生成圖片。",
      "FINAL_IMAGE_PROMPT 階段必須產出 finalImagePrompt、qrcodePolicy、portraitPolicy、failsafePolicy。",
      "POST /api/session/image-package 只能在 FINAL_IMAGE_PROMPT 完成後呼叫。",
      "image-package 階段不得寫入 generated_at、completed_at，也不得把 session 直接改成 COMPLETED。",
      "完成 image-package 後，只能推進到 IMAGE_GENERATION_READY。",
      "圖片尚未生成成功前，不得呼叫 complete-generation。",
      "若 session 已在較後階段，不得重跑前面 API，除非使用者明確修改相關資料。",
      "若使用者修改價格、地址、坪數、格局、屋齡、主標、副標或賣點，必須退回 USER_CONFIRMATION 並重新跑合規檢查。",
      "若只修改風格，可從 STYLE_SELECTION 重新進入 FINAL_IMAGE_PROMPT。",
      "若只修改版面，例如 QR Code 位置、人物位置、主標位置，可從 FINAL_IMAGE_PROMPT 重新整理 image-package。",
      "每次回覆前必須判斷目前 sessionId、current_stage、上一個 API 是否成功、下一個允許階段、是否需要使用者確認、是否可以生成圖片。",
      "若不確定 current_stage，必須先查詢 session 狀態，不得自行猜測。",
    ],
    material_status: [
      "只判斷素材狀態，不得儲存圖片本體。",
      "只可記錄 propertyPhotosCount、hasBusinessCard、hasPortrait、hasQrcode。",
      "不得把圖片、PDF、QR Code、人物照、房屋照片、名片圖片傳入後端。",
      "完成素材狀態判斷後，才可呼叫 updateMaterialStatus。",
      "完成 updateMaterialStatus 後，不得直接進入 compliance_check、style_selection、final_image_prompt 或圖片生成。",
    ],
    property_confirmation: [
      "不得自行腦補價格、地址、格局、車位、坪數、屋齡、樓層、電話、證號、公司名稱。",
      "必須分成已確認資料與待補資料。",
      "已確認資料只能放使用者明確提供、素材清楚可辨識或 API 明確回傳的內容。",
      "缺少、不清楚或需要確認的資料只能放在待補資料。",
      "不得把未填、待補、不詳、無資料、待確認、不確定等字樣寫入 propertyData。",
      "使用者明確確認前，不得呼叫 savePropertyData。",
      "使用者明確確認前，不得呼叫 confirmPropertyData。",
      "若使用者補充或修改資料，必須重新整理一次，再請使用者確認。",
    ],
    compliance_check: [
      "只有 confirmPropertyData 成功後，才可以進行合規檢查。",
      "檢查是否有誇大不實、保證獲利、絕對化用語。",
      "檢查是否使用未確認資料。",
      "檢查是否缺少必要揭露資訊。",
      "檢查是否自行補電話、證號或公司資訊。",
      "合規不通過時，列出問題與修改建議，不得進入風格選擇。",
      "合規不通過時，不得產生 finalImagePrompt。",
      "合規通過後，才可呼叫 saveComplianceCheck。",
    ],
    style_selection: [
      "只有合規檢查通過後，才能進入風格選擇。",
      "使用者選定風格後，才可呼叫 selectImageStyle。",
      "selectedStyle 必須使用 OpenAPI 允許的英文代碼。",
      "目前允許的 selectedStyle 為 modern_clean、luxury_premium、warm_lifestyle。",
      "不得把中文風格名稱直接送入 selectedStyle。",
      "正確 API 是 POST /api/session/style-selection。",
      "禁止使用 POST /api/session/select-image-style。",
      "style-selection 成功後，只能進入 FINAL_IMAGE_PROMPT，不得直接生成圖片。",
    ],
    final_image_prompt: [
      "只能在使用者確認物件資料、savePropertyData 成功、confirmPropertyData 成功、合規通過、saveComplianceCheck 成功、selectImageStyle 成功後產生。",
      "finalImagePrompt 只能使用已確認資料。",
      "必須同時整理 finalImagePrompt、qrcodePolicy、portraitPolicy、failsafePolicy。",
      "未確認價格不得放價格。",
      "未確認地址不得顯示完整地址。",
      "不得加入未確認的格局、車位、坪數、電話、證號或公司資訊。",
      "若有提供人物照，人物五官、臉型、身形比例與自然表情不得變形、重畫或卡通化。",
      "未提供人物照時，不得生成虛構人物。",
      "若有提供 QR Code，必須預留乾淨 QR Code 放置區，且不得變形、模糊或被遮擋。",
      "未提供 QR Code 時，不得生成假的 QR Code。",
      "只能使用使用者上傳的房屋照片，不得憑空生成不存在的室內照、外觀照或街景。",
      "完成 finalImagePrompt 後，才可呼叫 saveImagePackage。",
      "saveImagePackage 只能儲存文字包，不得儲存圖片。",
    ],
    image_generation_failsafe: [
      "圖片生成必須是 FB 4:5 直式版面。",
      "只能使用已確認資料，不得新增未確認資訊。",
      "不得變形人物。",
      "不得重畫 QR Code。",
      "必須預留 QR Code 放置區。",
      "文字必須清楚可讀，不得產生亂碼。",
      "不得產生不存在的建物、室內照、外觀照或街景。",
      "不得遮擋房屋照片、揭露資訊或聯絡資訊。",
      "若生成結果有人物變形、QR Code 不可掃描、文字錯誤、價格錯誤、地址錯誤、虛構房屋或揭露資訊缺漏，必須提醒使用者重新生成或修正。",
      "圖片成功生成後，才可以呼叫 POST /api/session/complete-generation。",
    ],
  };

  return rules[stage];
}

function getNextInstruction(stage: Stage): string {
  const instructions: Record<Stage, string> = {
    gpts_api_flow:
      "請依照 mustFollow 判斷目前 session stage，嚴格依序推進 API；不得跳過 USER_CONFIRMATION、COMPLIANCE_CHECK、FINAL_IMAGE_PROMPT 或 IMAGE_GENERATION_READY。",
    material_status:
      "請依照 mustFollow 判斷素材狀態，完成後呼叫 updateMaterialStatus。",
    property_confirmation:
      "請依照 mustFollow 整理已確認資料與待補資料，並請使用者明確確認；確認前不得寫入 propertyData。",
    compliance_check:
      "請依照 mustFollow 進行合規檢查；合規通過後呼叫 saveComplianceCheck，未通過則停止並列出修改建議。",
    style_selection:
      "請依照 mustFollow 提供可用風格選項；使用者選定後，將中文選項轉成允許的英文 selectedStyle 再呼叫 selectImageStyle。",
    final_image_prompt:
      "請依照 mustFollow 產生純文字 finalImagePrompt、qrcodePolicy、portraitPolicy、failsafePolicy，完成後呼叫 saveImagePackage。",
    image_generation_failsafe:
      "請依照 mustFollow 進行圖片生成前最後檢查，通過且 current_stage = IMAGE_GENERATION_READY 後才進入圖片生成。",
  };

  return instructions[stage];
}

async function getSession(sessionId: string) {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("id, current_stage, status, completed_at")
    .eq("id", sessionId)
    .maybeSingle();

  return { data, error };
}

async function getPropertyData(sessionId: string) {
  const { data, error } = await supabaseAdmin
    .from("session_property_data")
    .select("id, confirmed, confirmed_at")
    .eq("session_id", sessionId)
    .maybeSingle();

  return { data, error };
}

async function getComplianceResult(sessionId: string) {
  const { data, error } = await supabaseAdmin
    .from("session_copy_results")
    .select("id, compliance_passed")
    .eq("session_id", sessionId)
    .maybeSingle();

  return { data, error };
}

async function getImagePackage(sessionId: string) {
  const { data, error } = await supabaseAdmin
    .from("session_image_packages")
    .select(
      "id, selected_style, final_image_prompt, qrcode_policy, portrait_policy, failsafe_policy, generated_at"
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { data, error };
}

function getNextActionByCurrentStage(currentStage: string) {
  const map: Record<
    string,
    {
      nextAction: string;
      mustCallNext: string;
      requiredStage: string;
    }
  > = {
    STORE_VERIFY: {
      nextAction: "verifyStore",
      mustCallNext: "verifyStore",
      requiredStage: "STORE_VERIFY",
    },
    STORE_DATA_LOADED: {
      nextAction: "loadStageRules",
      mustCallNext: "loadStageRules",
      requiredStage: "material_status",
    },
    MATERIAL_UPLOAD_GUIDE: {
      nextAction: "updateMaterialStatus",
      mustCallNext: "updateMaterialStatus",
      requiredStage: "material_status",
    },
    DATA_EXTRACTION: {
      nextAction: "loadStageRules",
      mustCallNext: "loadStageRules",
      requiredStage: "property_confirmation",
    },
    USER_CONFIRMATION: {
      nextAction: "confirmPropertyData",
      mustCallNext: "confirmPropertyData",
      requiredStage: "USER_CONFIRMATION",
    },
    COMPLIANCE_CHECK: {
      nextAction: "saveComplianceCheck",
      mustCallNext: "saveComplianceCheck",
      requiredStage: "COMPLIANCE_CHECK",
    },
    STYLE_SELECTION: {
      nextAction: "selectImageStyle",
      mustCallNext: "selectImageStyle",
      requiredStage: "STYLE_SELECTION",
    },
    FINAL_IMAGE_PROMPT: {
      nextAction: "saveImagePackage",
      mustCallNext: "saveImagePackage",
      requiredStage: "FINAL_IMAGE_PROMPT",
    },
    IMAGE_GENERATION_READY: {
      nextAction: "image_generation",
      mustCallNext: "image_generation",
      requiredStage: "IMAGE_GENERATION_READY",
    },
    COMPLETED: {
      nextAction: "none",
      mustCallNext: "none",
      requiredStage: "COMPLETED",
    },
  };

  return (
    map[currentStage] ?? {
      nextAction: "getSessionStatus",
      mustCallNext: "getSessionStatus",
      requiredStage: currentStage,
    }
  );
}

async function guardRequestedStageMatchesCurrentStage(
  stage: Stage,
  sessionId: unknown
) {
  if (stage === "gpts_api_flow") {
    return null;
  }

  if (typeof sessionId !== "string" || !sessionId) {
    return missingSessionIdResponse(stage);
  }

  if (!isValidUuid(sessionId)) {
    return invalidSessionIdResponse(stage);
  }

  const { data: session, error } = await getSession(sessionId);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        blocked: true,
        version: API_VERSION,
        error: "FAILED_TO_CHECK_SESSION",
        message: error.message,
      },
      { status: 500 }
    );
  }

  if (!session) {
    return blockResponse({
      error: "SESSION_NOT_FOUND",
      message: "Session not found. You must startSession before continuing.",
      nextAction: "startSession",
      mustCallNext: "startSession",
      requiredStage: "STORE_VERIFY",
    });
  }

  const allowedCurrentStagesByRequestedStage: Record<Stage, string[]> = {
    gpts_api_flow: [
      "STORE_VERIFY",
      "STORE_DATA_LOADED",
      "MATERIAL_UPLOAD_GUIDE",
      "DATA_EXTRACTION",
      "USER_CONFIRMATION",
      "COMPLIANCE_CHECK",
      "STYLE_SELECTION",
      "FINAL_IMAGE_PROMPT",
      "IMAGE_GENERATION_READY",
      "COMPLETED",
    ],
    material_status: ["STORE_DATA_LOADED", "MATERIAL_UPLOAD_GUIDE"],
    property_confirmation: ["DATA_EXTRACTION", "USER_CONFIRMATION"],
    compliance_check: ["COMPLIANCE_CHECK"],
    style_selection: ["STYLE_SELECTION"],
    final_image_prompt: ["FINAL_IMAGE_PROMPT"],
    image_generation_failsafe: ["IMAGE_GENERATION_READY"],
  };

  const allowedCurrentStages = allowedCurrentStagesByRequestedStage[stage];

  if (!allowedCurrentStages.includes(session.current_stage)) {
    const next = getNextActionByCurrentStage(session.current_stage);

    return blockResponse({
      error: "INVALID_STAGE",
      message: `Current stage is ${session.current_stage}. You cannot load ${stage} rules at this stage. You must call ${next.mustCallNext} first.`,
      nextAction: next.nextAction,
      mustCallNext: next.mustCallNext,
      requiredStage: next.requiredStage,
    });
  }

  return null;
}

async function guardPropertyConfirmed(sessionId: string, targetStage: Stage) {
  const { data: propertyData, error } = await getPropertyData(sessionId);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        blocked: true,
        version: API_VERSION,
        error: "FAILED_TO_CHECK_PROPERTY_CONFIRMATION",
        message: error.message,
      },
      { status: 500 }
    );
  }

  if (!propertyData) {
    return blockResponse({
      error: "PROPERTY_DATA_NOT_FOUND",
      message: `Property data is missing. You must call savePropertyData before loading ${targetStage} rules.`,
      nextAction: "savePropertyData",
      mustCallNext: "savePropertyData",
      requiredStage: "PROPERTY_CONFIRMATION",
    });
  }

  if (propertyData.confirmed !== true) {
    return blockResponse({
      error: "PROPERTY_DATA_NOT_CONFIRMED",
      message: `Property data is not confirmed. You must call confirmPropertyData before loading ${targetStage} rules.`,
      nextAction: "confirmPropertyData",
      mustCallNext: "confirmPropertyData",
      requiredStage: "USER_CONFIRMATION",
    });
  }

  return null;
}

async function guardComplianceCheck(sessionId: unknown) {
  const stage: Stage = "compliance_check";

  if (typeof sessionId !== "string" || !sessionId) {
    return missingSessionIdResponse(stage);
  }

  if (!isValidUuid(sessionId)) {
    return invalidSessionIdResponse(stage);
  }

  return await guardPropertyConfirmed(sessionId, stage);
}

async function guardStyleSelection(sessionId: unknown) {
  const stage: Stage = "style_selection";

  if (typeof sessionId !== "string" || !sessionId) {
    return missingSessionIdResponse(stage);
  }

  if (!isValidUuid(sessionId)) {
    return invalidSessionIdResponse(stage);
  }

  const propertyGuard = await guardPropertyConfirmed(sessionId, stage);

  if (propertyGuard) {
    return propertyGuard;
  }

  const { data: complianceResult, error } = await getComplianceResult(sessionId);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        blocked: true,
        version: API_VERSION,
        error: "FAILED_TO_CHECK_COMPLIANCE_RESULT",
        message: error.message,
      },
      { status: 500 }
    );
  }

  if (!complianceResult) {
    return blockResponse({
      error: "COMPLIANCE_RESULT_NOT_FOUND",
      message:
        "Compliance result is missing. You must call saveComplianceCheck before loading style_selection rules.",
      nextAction: "saveComplianceCheck",
      mustCallNext: "saveComplianceCheck",
      requiredStage: "COMPLIANCE_CHECK",
    });
  }

  if (complianceResult.compliance_passed !== true) {
    return blockResponse({
      error: "COMPLIANCE_CHECK_NOT_PASSED",
      message:
        "Compliance check has not passed. You cannot load style_selection rules before compliancePassed is true.",
      nextAction: "saveComplianceCheck",
      mustCallNext: "saveComplianceCheck",
      requiredStage: "COMPLIANCE_CHECK",
    });
  }

  return null;
}

async function guardFinalImagePrompt(sessionId: unknown) {
  const stage: Stage = "final_image_prompt";

  if (typeof sessionId !== "string" || !sessionId) {
    return missingSessionIdResponse(stage);
  }

  if (!isValidUuid(sessionId)) {
    return invalidSessionIdResponse(stage);
  }

  const styleGuard = await guardStyleSelection(sessionId);

  if (styleGuard) {
    return styleGuard;
  }

  const { data: imagePackage, error } = await getImagePackage(sessionId);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        blocked: true,
        version: API_VERSION,
        error: "FAILED_TO_CHECK_STYLE_SELECTION",
        message: error.message,
      },
      { status: 500 }
    );
  }

  if (!imagePackage || !imagePackage.selected_style) {
    return blockResponse({
      error: "STYLE_SELECTION_NOT_FOUND",
      message:
        "Style selection is missing. You must call selectImageStyle before loading final_image_prompt rules.",
      nextAction: "selectImageStyle",
      mustCallNext: "selectImageStyle",
      requiredStage: "STYLE_SELECTION",
    });
  }

  return null;
}

async function guardImageGenerationFailsafe(sessionId: unknown) {
  const stage: Stage = "image_generation_failsafe";

  if (typeof sessionId !== "string" || !sessionId) {
    return missingSessionIdResponse(stage);
  }

  if (!isValidUuid(sessionId)) {
    return invalidSessionIdResponse(stage);
  }

  const finalPromptGuard = await guardFinalImagePrompt(sessionId);

  if (finalPromptGuard) {
    return finalPromptGuard;
  }

  const { data: session, error: sessionError } = await getSession(sessionId);

  if (sessionError) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        blocked: true,
        version: API_VERSION,
        error: "FAILED_TO_CHECK_SESSION",
        message: sessionError.message,
      },
      { status: 500 }
    );
  }

  if (!session) {
    return blockResponse({
      error: "SESSION_NOT_FOUND",
      message: "Session not found. You must startSession before continuing.",
      nextAction: "startSession",
      mustCallNext: "startSession",
      requiredStage: "STORE_VERIFY",
    });
  }

  const { data: imagePackage, error } = await getImagePackage(sessionId);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        blocked: true,
        version: API_VERSION,
        error: "FAILED_TO_CHECK_IMAGE_PACKAGE",
        message: error.message,
      },
      { status: 500 }
    );
  }

  if (!imagePackage || !imagePackage.final_image_prompt) {
    return blockResponse({
      error: "IMAGE_PACKAGE_NOT_FOUND",
      message:
        "Image package is missing. You must call saveImagePackage before loading image_generation_failsafe rules.",
      nextAction: "saveImagePackage",
      mustCallNext: "saveImagePackage",
      requiredStage: "FINAL_IMAGE_PROMPT",
    });
  }

  if (session.current_stage !== "IMAGE_GENERATION_READY") {
    return blockResponse({
      error: "SESSION_NOT_READY_FOR_IMAGE_GENERATION",
      message: `Current stage is ${session.current_stage}. You must complete saveImagePackage before loading image_generation_failsafe rules.`,
      nextAction: "saveImagePackage",
      mustCallNext: "saveImagePackage",
      requiredStage: "FINAL_IMAGE_PROMPT",
    });
  }

  return null;
}

async function guardStage(stage: Stage, sessionId: unknown) {
  if (stage === "compliance_check") {
    return await guardComplianceCheck(sessionId);
  }

  if (stage === "style_selection") {
    return await guardStyleSelection(sessionId);
  }

  if (stage === "final_image_prompt") {
    return await guardFinalImagePrompt(sessionId);
  }

  if (stage === "image_generation_failsafe") {
    return await guardImageGenerationFailsafe(sessionId);
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const stage = body?.stage;
    const sessionId = body?.sessionId;

    if (!stage) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          version: API_VERSION,
          error: "Missing required field: stage",
          allowedStages: ALLOWED_STAGES,
        },
        { status: 400 }
      );
    }

    if (!isValidStage(stage)) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          version: API_VERSION,
          error: `Invalid stage: ${String(stage)}`,
          allowedStages: ALLOWED_STAGES,
        },
        { status: 400 }
      );
    }

    const stageLockResponse = await guardRequestedStageMatchesCurrentStage(
      stage,
      sessionId
    );

    if (stageLockResponse) {
      return stageLockResponse;
    }

    const guardResponse = await guardStage(stage, sessionId);

    if (guardResponse) {
      return guardResponse;
    }

    return NextResponse.json({
      ok: true,
      success: true,
      stage,
      sessionId: typeof sessionId === "string" ? sessionId : null,
      ruleTitle: getRuleTitle(stage),
      ruleSummary: getRuleSummary(stage),
      mustFollow: getMustFollow(stage),
      nextInstruction: getNextInstruction(stage),
      version: API_VERSION,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        version: API_VERSION,
        error: "Invalid request body",
        detail: error instanceof Error ? error.message : String(error),
        allowedStages: ALLOWED_STAGES,
      },
      { status: 400 }
    );
  }
}
