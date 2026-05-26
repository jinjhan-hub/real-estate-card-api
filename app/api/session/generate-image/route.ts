import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenerateImageBody = {
  sessionId?: string;
  mode?: "mock" | "manual";
};

const REQUIRED_STAGE = "IMAGE_GENERATION_READY";

function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateImageBody;

    const sessionId = body.sessionId?.trim();
    const mode = body.mode ?? "manual";
    const isMock = mode === "mock";

    if (!sessionId) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "MISSING_SESSION_ID",
          message: "sessionId is required before generating image.",
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
        },
        400
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
          success: false,
          blocked: true,
          error: "SESSION_NOT_FOUND",
          message: "Session not found.",
          sessionId,
          nextAction: "startSession",
          mustCallNext: "startSession",
        },
        404
      );
    }

    const currentStage = session.current_stage;

    if (currentStage !== REQUIRED_STAGE) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "INVALID_STAGE",
          message: `Invalid stage. Current stage is ${currentStage}, expected ${REQUIRED_STAGE}.`,
          sessionId,
          currentStage,
          requiredStage: REQUIRED_STAGE,
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
        },
        409
      );
    }

    const { data: imagePackage, error: imagePackageError } =
      await supabaseAdmin
        .from("session_image_packages")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();

    const warnings: string[] = [];

    if (imagePackageError) {
      warnings.push(`session_image_packages 查詢錯誤：${imagePackageError.message}`);
    }

    if (!imagePackage) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "IMAGE_PACKAGE_NOT_FOUND",
          message: "找不到 session_image_packages row，無法產生 GPTs 對話端產圖文字包。",
          sessionId,
          currentStage,
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
        },
        409
      );
    }

    const missingFields: string[] = [];

    if (!imagePackage.selected_style) missingFields.push("selected_style");
    if (!imagePackage.final_image_prompt) missingFields.push("final_image_prompt");
    if (!imagePackage.qrcode_policy) missingFields.push("qrcode_policy");
    if (!imagePackage.portrait_policy) missingFields.push("portrait_policy");
    if (!imagePackage.failsafe_policy) missingFields.push("failsafe_policy");

    if (missingFields.length > 0) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          blocked: true,
          error: "INCOMPLETE_IMAGE_PACKAGE",
          message: `Image package is incomplete. Missing fields: ${missingFields.join(
            ", "
          )}.`,
          sessionId,
          currentStage,
          missingFields,
          nextAction: "getSessionStatus",
          mustCallNext: "getSessionStatus",
        },
        409
      );
    }

    const imageGenerationPackage = {
      mode,
      imageHandling: "GPTS_CONVERSATION_ONLY",
      storagePolicy: {
        apiReceivesImages: false,
        apiStoresImages: false,
        databaseStoresImages: false,
        databaseStoresImageUrls: false,
        imageBase64Allowed: false,
        imageUrlAllowed: false,
        textOnlyApi: true,
      },
      selectedStyle: imagePackage.selected_style,
      finalImagePrompt: imagePackage.final_image_prompt,
      qrcodePolicy: imagePackage.qrcode_policy,
      portraitPolicy: imagePackage.portrait_policy,
      failsafePolicy: imagePackage.failsafe_policy,
      instruction:
        "請在 GPTs 對話端使用使用者上傳的房屋照、人物照與 QR Code 生成圖片。API 與資料庫不得接收、儲存或回傳任何圖片、圖片網址或 base64。圖片生成後必須在對話端人工檢查，確認通過後才可呼叫 completeGeneration。",
      reviewChecklist: [
        "房屋照片不得被 AI 改造成不存在的空間、裝潢、家具、景觀或車庫。",
        "若 hasPortrait = true，人物照不得換臉、不得修改五官、不得改變臉型或比例。",
        "若 hasPortrait = false，不得生成虛構人物、假房仲或假代言人。",
        "若 hasQrcode = true，QR Code 不得重畫、不得偽造、不得變形，且須由使用者實際掃描確認。",
        "若 hasQrcode = false，不得生成假 QR Code。",
        "圖卡文字不得新增不存在的價格、地址、坪數、格局、屋齡、車位、學區、商圈或賣點。",
        "未完成人工視覺檢查前，不得呼叫 completeGeneration。",
      ],
    };

    if (isMock) {
      const generatedImageUrl = "/mnt/data/mock-real-estate-card.png";

      const generationResult = {
        success: true,
        imageCount: 1,
        outputPaths: [generatedImageUrl],
        generatedImageUrl,
        checked: true,
        passed: true,
        mode,
        mock: true,
        reviewMethod: "mock_flow_test",
        notes: "Mock image generation completed. This is only for flow testing.",
      };

      return jsonResponse({
        ok: true,
        success: true,
        blocked: false,
        sessionId,
        currentStage,
        nextStage: currentStage,
        nextAction: "completeGeneration",
        mustCallNext: "completeGeneration",
        imageGenerated: true,
        image_generated: true,
        generatedImageUrl,
        generated_image_url: generatedImageUrl,
        outputPaths: [generatedImageUrl],
        imageGenerationPackage,
        generationResult,
        warnings,
        message: "Mock image generation completed. Ready to call completeGeneration.",
      });
    }

    return jsonResponse({
      ok: true,
      success: true,
      blocked: false,
      sessionId,
      currentStage,
      nextStage: currentStage,
      nextAction: "generateImageInConversation",
      mustCallNext: "generateImageInConversation",
      imageGenerated: false,
      image_generated: false,
      generatedImageUrl: null,
      generated_image_url: null,
      outputPaths: [],
      imageGenerationPackage,
      generationResult: {
        success: false,
        imageCount: 0,
        outputPaths: [],
        generatedImageUrl: null,
        checked: false,
        passed: false,
        mode,
        mock: false,
        reviewMethod: "manual_visual_review_in_gpts",
        failedReason: "WAITING_FOR_GPTS_CONVERSATION_IMAGE_GENERATION",
        notes:
          "API has returned a text-only image generation package. Generate the image inside GPTs conversation using user-uploaded assets, then manually review it before completeGeneration.",
      },
      warnings,
      message:
        "Text-only image generation package prepared. Generate the image in GPTs conversation, then manually review before completeGeneration.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return jsonResponse(
      {
        ok: false,
        success: false,
        blocked: true,
        error: "GENERATE_IMAGE_FAILED",
        message,
        nextAction: "getSessionStatus",
        mustCallNext: "getSessionStatus",
      },
      500
    );
  }
}
