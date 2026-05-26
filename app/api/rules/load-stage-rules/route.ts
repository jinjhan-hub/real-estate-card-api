import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const GITHUB_RULE_BASE_URL =
  "https://raw.githubusercontent.com/jinjhan-hub/real-estate-gpt-knowledge/main/fb_card_public/stage_rules/v1";

const STAGE_RULE_MAP = {
  material_status: {
    ruleKey: "01_material_status",
    fileName: "01_material_status.md",
    requiredStage: "MATERIAL_STATUS",
    nextAction: "updateMaterialStatus",
    mustCallNext: "updateMaterialStatus",
    nextInstruction:
      "請根據本階段規則，整理使用者已提供的素材狀態。只記錄文字化素材狀態，不得儲存圖片、PDF、QR Code、人物照、房屋照片等非文字素材。完成後必須呼叫 updateMaterialStatus。",
  },

  property_confirmation: {
    ruleKey: "02_property_confirmation",
    fileName: "02_property_confirmation.md",
    requiredStage: "PROPERTY_CONFIRMATION",
    nextAction: "savePropertyData",
    mustCallNext: "waitForUserConfirmationBeforeSavePropertyData",
    nextInstruction:
      "請根據本階段規則，整理已提供的物件資料，列出可用於圖卡的文字資訊。不得補未提供資料。整理後必須等待使用者明確確認，使用者確認前不得呼叫 savePropertyData。",
  },

  compliance_check: {
    ruleKey: "03_compliance_check",
    fileName: "03_compliance_check.md",
    requiredStage: "COMPLIANCE_CHECK",
    nextAction: "saveComplianceCheck",
    mustCallNext: "saveComplianceCheck",
    nextInstruction:
      "請根據本階段規則，檢查已確認物件資料與預計使用文字是否符合銷售圖卡合規要求。不得新增電話、LINE ID、完整地址或未提供的房產資訊。完成後必須呼叫 saveComplianceCheck。",
  },

  style_selection: {
    ruleKey: "04_style_selection",
    fileName: "04_style_selection.md",
    requiredStage: "STYLE_SELECTION",
    nextAction: "selectImageStyle",
    mustCallNext: "selectImageStyle",
    nextInstruction:
      "請根據本階段規則，提供可選風格並等待使用者選擇。若使用者已明確指定風格，請整理 selectedStyle，並呼叫 selectImageStyle。",
  },

  final_image_prompt: {
    ruleKey: "05_final_image_prompt",
    fileName: "05_final_image_prompt.md",
    requiredStage: "FINAL_IMAGE_PROMPT",
    nextAction: "saveFinalImagePrompt",
    mustCallNext: "saveFinalImagePrompt",
    nextInstruction:
      "請根據本階段規則，只使用已確認物件資料與 selectedStyle 建立 finalImagePrompt。不得補未提供資訊，不得加入電話、LINE ID、完整地址、學區、商圈、交通資訊。完成後必須呼叫 saveFinalImagePrompt。",
  },

  image_generation_failsafe: {
    ruleKey: "06_image_generation_failsafe",
    fileName: "06_image_generation_failsafe.md",
    requiredStage: "IMAGE_POLICIES",
    nextAction: "saveImagePolicies",
    mustCallNext: "saveImagePolicies",
    nextInstruction:
      "請根據本階段規則，建立圖片生成保護政策。必須保留 QR Code 不重畫、不偽造，人物不變形，未提供人物照不得生成虛構人物，不生成不存在的房屋實景，不新增電話、LINE ID、完整地址或未提供資訊。完成後必須呼叫 saveImagePolicies。",
  },
} as const;

type StageKey = keyof typeof STAGE_RULE_MAP;

function isStageKey(stage: string): stage is StageKey {
  return stage in STAGE_RULE_MAP;
}

function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function fetchStageRule(fileName: string) {
  const url = `${GITHUB_RULE_BASE_URL}/${fileName}`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "text/markdown; charset=utf-8, text/plain; charset=utf-8",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load rule file: ${fileName}`);
  }

  const buffer = await response.arrayBuffer();
  const decoder = new TextDecoder("utf-8");

  return decoder.decode(buffer);
}

async function getSessionCurrentStage(sessionId: string) {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("id, current_stage, completed_at")
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    return {
      ok: false,
      session: null,
      message: error?.message ?? "Session not found.",
    };
  }

  return {
    ok: true,
    session: data,
    message: "Session loaded.",
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const stage = body?.stage;
    const sessionId = body?.sessionId ?? null;

    if (!sessionId || typeof sessionId !== "string") {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          sessionId: null,
          stage: stage ?? null,
          ruleLoaded: false,
          ruleKey: null,
          currentStage: null,
          requiredStage: null,
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
          nextInstruction:
            "缺少 sessionId，請先呼叫 startSession 或 getSessionStatus，取得目前 session 狀態後再載入階段規則。",
          message: "Missing sessionId.",
        },
        400
      );
    }

    if (!stage || typeof stage !== "string") {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          sessionId,
          stage: null,
          ruleLoaded: false,
          ruleKey: null,
          currentStage: null,
          requiredStage: null,
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
          nextInstruction:
            "缺少 stage，請先確認目前流程階段，再呼叫 loadStageRules。",
          message: "Missing stage.",
        },
        400
      );
    }

    if (!isStageKey(stage)) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          sessionId,
          stage,
          ruleLoaded: false,
          ruleKey: null,
          currentStage: null,
          requiredStage: null,
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
          nextInstruction:
            "stage 不在允許清單內，請先確認目前流程階段，再呼叫正確的 loadStageRules。",
          message: `Unknown stage: ${stage}`,
        },
        400
      );
    }

    const ruleConfig = STAGE_RULE_MAP[stage];

    const sessionResult = await getSessionCurrentStage(sessionId);

    if (!sessionResult.ok || !sessionResult.session) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          sessionId,
          stage,
          ruleLoaded: false,
          ruleKey: ruleConfig.ruleKey,
          currentStage: null,
          requiredStage: ruleConfig.requiredStage,
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
          nextInstruction:
            "查無 session，請先呼叫 startSession 建立流程，或確認 sessionId 是否正確。",
          message: sessionResult.message,
        },
        404
      );
    }

    const currentStage = sessionResult.session.current_stage;
    const completedAt = sessionResult.session.completed_at;

    if (completedAt) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          sessionId,
          stage,
          ruleLoaded: false,
          ruleKey: ruleConfig.ruleKey,
          currentStage,
          requiredStage: ruleConfig.requiredStage,
          nextAction: null,
          mustCallNext: null,
          nextInstruction:
            "此 session 已完成，不得重新載入階段規則或重跑流程。若要重新測試，請建立新的 session。",
          message: "Session already completed.",
        },
        409
      );
    }

    if (currentStage !== ruleConfig.requiredStage) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          sessionId,
          stage,
          ruleLoaded: false,
          ruleKey: ruleConfig.ruleKey,
          currentStage,
          requiredStage: ruleConfig.requiredStage,
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
          nextInstruction:
            "目前 session 階段不符合此規則載入條件。請先依 currentStage 接續流程，不得跳步載入其他階段規則。",
          message: `Stage mismatch. Current stage is ${currentStage}, but required stage is ${ruleConfig.requiredStage}.`,
        },
        409
      );
    }

    const rule = await fetchStageRule(ruleConfig.fileName);

    return jsonResponse({
      ok: true,
      success: true,
      blocked: false,
      sessionId,
      stage,
      ruleLoaded: true,
      ruleKey: ruleConfig.ruleKey,
      currentStage,
      requiredStage: ruleConfig.requiredStage,
      nextAction: ruleConfig.nextAction,
      mustCallNext: ruleConfig.mustCallNext,
      nextInstruction: ruleConfig.nextInstruction,
      message: "Stage rule loaded successfully.",
      rule,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown loadStageRules error.";

    return jsonResponse(
      {
        ok: false,
        success: false,
        blocked: true,
        sessionId: null,
        stage: null,
        ruleLoaded: false,
        ruleKey: null,
        currentStage: null,
        requiredStage: null,
        nextAction: "getSessionStatus",
        mustCallNext: "getSessionStatus",
        nextInstruction:
          "規則載入失敗，請先檢查 GitHub raw markdown 是否可讀、Supabase 連線是否正常，或確認 stage 是否正確。",
        message,
      },
      500
    );
  }
}
