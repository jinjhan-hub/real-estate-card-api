import { NextResponse } from "next/server";

type Stage =
  | "material_status"
  | "property_confirmation"
  | "compliance_check"
  | "style_selection"
  | "final_image_prompt"
  | "image_generation_failsafe";

const ALLOWED_STAGES: Stage[] = [
  "material_status",
  "property_confirmation",
  "compliance_check",
  "style_selection",
  "final_image_prompt",
  "image_generation_failsafe",
];

function isValidStage(stage: unknown): stage is Stage {
  return typeof stage === "string" && ALLOWED_STAGES.includes(stage as Stage);
}

function getRuleTitle(stage: Stage): string {
  const titles: Record<Stage, string> = {
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
    material_status: [
      "只判斷素材狀態，不得儲存圖片本體。",
      "只可記錄 propertyPhotosCount、hasBusinessCard、hasPortrait、hasQrcode。",
      "不得把圖片、PDF、QR Code、人物照、房屋照片、名片圖片傳入後端。",
      "完成素材狀態判斷後，才可呼叫 updateMaterialStatus。",
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
    ],

    final_image_prompt: [
      "只能在使用者確認物件資料、savePropertyData 成功、confirmPropertyData 成功、合規通過、saveComplianceCheck 成功、selectImageStyle 成功後產生。",
      "finalImagePrompt 只能使用已確認資料。",
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
    ],
  };

  return rules[stage];
}

function getNextInstruction(stage: Stage): string {
  const instructions: Record<Stage, string> = {
    material_status:
      "請依照 mustFollow 判斷素材狀態，完成後呼叫 updateMaterialStatus。",
    property_confirmation:
      "請依照 mustFollow 整理已確認資料與待補資料，並請使用者明確確認；確認前不得寫入 propertyData。",
    compliance_check:
      "請依照 mustFollow 進行合規檢查；合規通過後呼叫 saveComplianceCheck，未通過則停止並列出修改建議。",
    style_selection:
      "請依照 mustFollow 提供可用風格選項；使用者選定後，將中文選項轉成允許的英文 selectedStyle 再呼叫 selectImageStyle。",
    final_image_prompt:
      "請依照 mustFollow 產生純文字 finalImagePrompt，完成後呼叫 saveImagePackage。",
    image_generation_failsafe:
      "請依照 mustFollow 進行圖片生成前最後檢查，通過後才進入圖片生成。",
  };

  return instructions[stage];
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const stage = body?.stage;

    if (!stage) {
      return NextResponse.json(
        {
          ok: false,
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
          error: `Invalid stage: ${String(stage)}`,
          allowedStages: ALLOWED_STAGES,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      stage,
      ruleTitle: getRuleTitle(stage),
      ruleSummary: getRuleSummary(stage),
      mustFollow: getMustFollow(stage),
      nextInstruction: getNextInstruction(stage),
      version: "1.0.1",
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid request body",
        allowedStages: ALLOWED_STAGES,
      },
      { status: 400 }
    );
  }
}