import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const API_VERSION = "1.0.6-simple-response";

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

function blockedResponse(params: {
  sessionId?: string;
  stage?: string;
  error: string;
  message: string;
  nextAction: string;
  mustCallNext: string;
  requiredStage?: string;
  status?: number;
}) {
  return NextResponse.json(
    {
      ok: false,
      success: false,
      sessionId: params.sessionId ?? "",
      stage: params.stage ?? "",
      ruleLoaded: false,
      ruleKey: "",
      nextInstruction: "",
      nextAction: params.nextAction,
      mustCallNext: params.mustCallNext,
      requiredStage: params.requiredStage ?? "",
      message: params.message,
      error: params.error,
      version: API_VERSION,
    },
    { status: params.status ?? 409 }
  );
}

function ruleLoadedResponse(params: {
  sessionId?: string;
  stage: Stage;
  ruleKey: string;
  nextInstruction: string;
}) {
  return NextResponse.json(
    {
      ok: true,
      success: true,
      sessionId: params.sessionId ?? "",
      stage: params.stage,
      ruleLoaded: true,
      ruleKey: params.ruleKey,
      nextInstruction: params.nextInstruction,
      message: "Rule loaded.",
      version: API_VERSION,
    },
    { status: 200 }
  );
}

function missingSessionIdResponse(stage: Stage) {
  return blockedResponse({
    stage,
    error: "MISSING_SESSION_ID",
    message: `sessionId is required before loading ${stage} rules.`,
    nextAction: "getSessionStatus",
    mustCallNext: "getSessionStatus",
    requiredStage: "",
  });
}

function invalidSessionIdResponse(stage: Stage, sessionId?: string) {
  return blockedResponse({
    sessionId,
    stage,
    error: "INVALID_SESSION_ID",
    message: `Invalid sessionId format before loading ${stage} rules.`,
    nextAction: "getSessionStatus",
    mustCallNext: "getSessionStatus",
    requiredStage: "",
    status: 400,
  });
}

function getRuleMeta(stage: Stage): {
  ruleKey: string;
  nextInstruction: string;
} {
  const map: Record<
    Stage,
    {
      ruleKey: string;
      nextInstruction: string;
    }
  > = {
    gpts_api_flow: {
      ruleKey: "00_GPTS_API_FLOW",
      nextInstruction:
        "Check current session stage and follow the required next action only.",
    },
    material_status: {
      ruleKey: "00_MATERIAL_STATUS",
      nextInstruction:
        "Check uploaded material status only. Do not store image files.",
    },
    property_confirmation: {
      ruleKey: "01_PROPERTY_CONFIRMATION",
      nextInstruction:
        "Extract confirmed property data and ask user for confirmation. Do not save property data before explicit confirmation.",
    },
    compliance_check: {
      ruleKey: "07_AD_COMPLIANCE_CHECK",
      nextInstruction:
        "Run compliance check based on confirmed property data only.",
    },
    style_selection: {
      ruleKey: "04_IMAGE_STYLE_LIBRARY",
      nextInstruction:
        "Ask user to choose one image style. Use allowed English selectedStyle code only.",
    },
    final_image_prompt: {
      ruleKey: "05_IMAGE_PROMPT_TEMPLATE",
      nextInstruction:
        "Generate finalImagePrompt draft only, then call saveFinalImagePrompt. Do not generate image yet.",
    },
    image_generation_failsafe: {
      ruleKey: "06_IMAGE_GENERATION_FAILSAFE",
      nextInstruction:
        "Save qrcodePolicy, portraitPolicy and failsafePolicy only, then call saveImagePolicies. Do not generate image yet.",
    },
  };

  return map[stage];
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
      nextAction: "saveFinalImagePrompt",
      mustCallNext: "saveFinalImagePrompt",
      requiredStage: "FINAL_IMAGE_PROMPT",
    },
    IMAGE_POLICIES: {
      nextAction: "loadStageRules",
      mustCallNext: "loadStageRules",
      requiredStage: "image_generation_failsafe",
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
    return invalidSessionIdResponse(stage, sessionId);
  }

  const { data: session, error } = await getSession(sessionId);

  if (error) {
    return blockedResponse({
      sessionId,
      stage,
      error: "FAILED_TO_CHECK_SESSION",
      message: error.message,
      nextAction: "getSessionStatus",
      mustCallNext: "getSessionStatus",
      requiredStage: "",
      status: 500,
    });
  }

  if (!session) {
    return blockedResponse({
      sessionId,
      stage,
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
      "IMAGE_POLICIES",
      "IMAGE_GENERATION_READY",
      "COMPLETED",
    ],
    material_status: ["STORE_DATA_LOADED", "MATERIAL_UPLOAD_GUIDE"],
    property_confirmation: ["DATA_EXTRACTION", "USER_CONFIRMATION"],
    compliance_check: ["COMPLIANCE_CHECK"],
    style_selection: ["STYLE_SELECTION"],
    final_image_prompt: ["FINAL_IMAGE_PROMPT"],
    image_generation_failsafe: ["IMAGE_POLICIES", "IMAGE_GENERATION_READY"],
  };

  const allowedCurrentStages = allowedCurrentStagesByRequestedStage[stage];

  if (!allowedCurrentStages.includes(session.current_stage)) {
    const next = getNextActionByCurrentStage(session.current_stage);

    return blockedResponse({
      sessionId,
      stage,
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
    return blockedResponse({
      sessionId,
      stage: targetStage,
      error: "FAILED_TO_CHECK_PROPERTY_CONFIRMATION",
      message: error.message,
      nextAction: "getSessionStatus",
      mustCallNext: "getSessionStatus",
      requiredStage: "",
      status: 500,
    });
  }

  if (!propertyData) {
    return blockedResponse({
      sessionId,
      stage: targetStage,
      error: "PROPERTY_DATA_NOT_FOUND",
      message: `Property data is missing. You must call savePropertyData before loading ${targetStage} rules.`,
      nextAction: "savePropertyData",
      mustCallNext: "savePropertyData",
      requiredStage: "PROPERTY_CONFIRMATION",
    });
  }

  if (propertyData.confirmed !== true) {
    return blockedResponse({
      sessionId,
      stage: targetStage,
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
    return invalidSessionIdResponse(stage, sessionId);
  }

  return await guardPropertyConfirmed(sessionId, stage);
}

async function guardStyleSelection(sessionId: unknown) {
  const stage: Stage = "style_selection";

  if (typeof sessionId !== "string" || !sessionId) {
    return missingSessionIdResponse(stage);
  }

  if (!isValidUuid(sessionId)) {
    return invalidSessionIdResponse(stage, sessionId);
  }

  const propertyGuard = await guardPropertyConfirmed(sessionId, stage);

  if (propertyGuard) {
    return propertyGuard;
  }

  const { data: complianceResult, error } = await getComplianceResult(sessionId);

  if (error) {
    return blockedResponse({
      sessionId,
      stage,
      error: "FAILED_TO_CHECK_COMPLIANCE_RESULT",
      message: error.message,
      nextAction: "getSessionStatus",
      mustCallNext: "getSessionStatus",
      requiredStage: "",
      status: 500,
    });
  }

  if (!complianceResult) {
    return blockedResponse({
      sessionId,
      stage,
      error: "COMPLIANCE_RESULT_NOT_FOUND",
      message:
        "Compliance result is missing. You must call saveComplianceCheck before loading style_selection rules.",
      nextAction: "saveComplianceCheck",
      mustCallNext: "saveComplianceCheck",
      requiredStage: "COMPLIANCE_CHECK",
    });
  }

  if (complianceResult.compliance_passed !== true) {
    return blockedResponse({
      sessionId,
      stage,
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
    return invalidSessionIdResponse(stage, sessionId);
  }

  const styleGuard = await guardStyleSelection(sessionId);

  if (styleGuard) {
    return styleGuard;
  }

  const { data: imagePackage, error } = await getImagePackage(sessionId);

  if (error) {
    return blockedResponse({
      sessionId,
      stage,
      error: "FAILED_TO_CHECK_STYLE_SELECTION",
      message: error.message,
      nextAction: "getSessionStatus",
      mustCallNext: "getSessionStatus",
      requiredStage: "",
      status: 500,
    });
  }

  if (!imagePackage || !imagePackage.selected_style) {
    return blockedResponse({
      sessionId,
      stage,
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
    return invalidSessionIdResponse(stage, sessionId);
  }

  const finalPromptGuard = await guardFinalImagePrompt(sessionId);

  if (finalPromptGuard) {
    return finalPromptGuard;
  }

  const { data: session, error: sessionError } = await getSession(sessionId);

  if (sessionError) {
    return blockedResponse({
      sessionId,
      stage,
      error: "FAILED_TO_CHECK_SESSION",
      message: sessionError.message,
      nextAction: "getSessionStatus",
      mustCallNext: "getSessionStatus",
      requiredStage: "",
      status: 500,
    });
  }

  if (!session) {
    return blockedResponse({
      sessionId,
      stage,
      error: "SESSION_NOT_FOUND",
      message: "Session not found. You must startSession before continuing.",
      nextAction: "startSession",
      mustCallNext: "startSession",
      requiredStage: "STORE_VERIFY",
    });
  }

  const { data: imagePackage, error } = await getImagePackage(sessionId);

  if (error) {
    return blockedResponse({
      sessionId,
      stage,
      error: "FAILED_TO_CHECK_IMAGE_PACKAGE",
      message: error.message,
      nextAction: "getSessionStatus",
      mustCallNext: "getSessionStatus",
      requiredStage: "",
      status: 500,
    });
  }

  if (!imagePackage || !imagePackage.final_image_prompt) {
    return blockedResponse({
      sessionId,
      stage,
      error: "FINAL_IMAGE_PROMPT_NOT_FOUND",
      message:
        "Final image prompt is missing. You must call saveFinalImagePrompt before loading image_generation_failsafe rules.",
      nextAction: "saveFinalImagePrompt",
      mustCallNext: "saveFinalImagePrompt",
      requiredStage: "FINAL_IMAGE_PROMPT",
    });
  }

  if (
    session.current_stage !== "IMAGE_POLICIES" &&
    session.current_stage !== "IMAGE_GENERATION_READY"
  ) {
    return blockedResponse({
      sessionId,
      stage,
      error: "SESSION_NOT_READY_FOR_IMAGE_POLICIES",
      message: `Current stage is ${session.current_stage}. You must call saveFinalImagePrompt before loading image_generation_failsafe rules.`,
      nextAction: "saveFinalImagePrompt",
      mustCallNext: "saveFinalImagePrompt",
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
          sessionId: typeof sessionId === "string" ? sessionId : "",
          stage: "",
          ruleLoaded: false,
          ruleKey: "",
          nextInstruction: "",
          nextAction: "loadStageRules",
          mustCallNext: "loadStageRules",
          requiredStage: "",
          message: "Missing required field: stage.",
          error: "MISSING_STAGE",
          version: API_VERSION,
        },
        { status: 400 }
      );
    }

    if (!isValidStage(stage)) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          sessionId: typeof sessionId === "string" ? sessionId : "",
          stage: String(stage),
          ruleLoaded: false,
          ruleKey: "",
          nextInstruction: "",
          nextAction: "loadStageRules",
          mustCallNext: "loadStageRules",
          requiredStage: "",
          message: `Invalid stage: ${String(stage)}.`,
          error: "INVALID_STAGE_NAME",
          version: API_VERSION,
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

    const rule = getRuleMeta(stage);

    return ruleLoadedResponse({
      sessionId: typeof sessionId === "string" ? sessionId : "",
      stage,
      ruleKey: rule.ruleKey,
      nextInstruction: rule.nextInstruction,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        sessionId: "",
        stage: "",
        ruleLoaded: false,
        ruleKey: "",
        nextInstruction: "",
        nextAction: "loadStageRules",
        mustCallNext: "loadStageRules",
        requiredStage: "",
        message: "Invalid request body.",
        error: error instanceof Error ? error.message : String(error),
        version: API_VERSION,
      },
      { status: 400 }
    );
  }
}
