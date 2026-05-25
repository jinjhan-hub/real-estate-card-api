import { NextResponse } from "next/server";

type Stage =
  | "material_status"
  | "property_confirmation"
  | "compliance_check"
  | "style_selection"
  | "final_image_prompt"
  | "image_generation_failsafe";

const STAGE_RULES: Record<Stage, string> = {
  material_status: `
# 素材狀態判斷規則

你現在的任務是判斷使用者提供了哪些素材。

只判斷素材狀態，不得儲存圖片本體。

可判斷欄位：
- propertyPhotosCount：物件照片張數
- hasBusinessCard：是否有名片
- hasPortrait：是否有人物照
- hasQrcode：是否有 QR Code

禁止事項：
- 不得要求後端儲存圖片
- 不得把圖片、PDF、QR Code、人物照、房屋照片傳入後端
- 只能將素材狀態用文字或布林值寫入 API
`,

  property_confirmation: `
# 物件資料整理與確認規則

你現在的任務是整理物件資料，但不得直接寫入 API。

必須分成：

【已確認資料】
只放使用者明確提供、素材中清楚可辨識，或 API 明確回傳的資料。

【待補資料】
只放缺少、不清楚、無法辨識或需要使用者確認的資料。

禁止事項：
- 不得自行腦補價格、地址、格局、車位、坪數、屋齡、電話、證號、公司名稱
- 不得把「未填、待補、不詳、無資料、待確認」寫入 propertyData
- 使用者確認前，不得呼叫 savePropertyData
- 使用者確認前，不得呼叫 confirmPropertyData

標準回覆格式：

目前階段：物件資料確認

我先整理目前可確認的資料。此階段尚未寫入後端。

【已確認資料】
1. 物件名稱：
2. 開價：
3. 地址：
4. 格局：
5. 車位：
6. 坪數：
7. 屋齡：
8. 樓層：
9. 主要賣點：
10. 聯絡資訊：
11. 店家揭露資料：

【待補資料】
1.
2.
3.

請確認以上資料是否正確。
若正確，請回覆「確認」。
你確認後，我才會寫入物件資料並進入合規檢查。
`,

  compliance_check: `
# 合規檢查規則

你現在的任務是檢查已確認的物件資料與圖卡文案是否適合用於台灣房仲 FB 銷售圖卡。

檢查重點：
1. 是否有誇大不實
2. 是否有保證獲利
3. 是否有絕對化用語
4. 是否使用未確認資料
5. 是否缺少必要揭露資訊
6. 是否可能誤導消費者
7. 是否自行補電話、證號或公司資訊
8. 是否符合台灣房仲廣告基本揭露需求

禁止高風險詞：
- 保證增值
- 穩賺不賠
- 絕對便宜
- 全區最低
- 秒殺
- 唯一
- 必買
- 最高投報
- 穩定收租保證
- 零風險

若合規不通過：
- 列出問題
- 提供修改建議
- 不得進入風格選擇
- 不得產生 finalImagePrompt
- 不得呼叫 selectImageStyle
- 不得呼叫 saveImagePackage

若合規通過：
- 可以呼叫 saveComplianceCheck
- 接著進入風格選擇
`,

  style_selection: `
# 風格選擇規則

你現在的任務是讓使用者選擇 FB 4:5 銷售圖卡風格。

只有合規檢查通過後，才能進入此階段。

請提供以下選項：

1. 溫暖自住感
2. 精品質感感
3. 首購友善感
4. 投資理性感
5. 簡約乾淨感
6. 社群吸睛感

標準回覆：

目前階段：風格選擇

合規檢查已通過。
請選擇本次 FB 4:5 銷售圖卡風格：

1. 溫暖自住感
2. 精品質感感
3. 首購友善感
4. 投資理性感
5. 簡約乾淨感
6. 社群吸睛感

請直接回覆編號或風格名稱。

使用者選定後，才可以呼叫 selectImageStyle。
`,

  final_image_prompt: `
# finalImagePrompt 產生規則

你現在的任務是產生圖片生成用文字包 finalImagePrompt。

只能在以下條件都完成後產生：
1. 使用者已確認物件資料
2. savePropertyData 成功
3. confirmPropertyData 成功
4. 合規檢查通過
5. saveComplianceCheck 成功
6. 使用者已選擇風格
7. selectImageStyle 成功

finalImagePrompt 只能使用已確認資料。

必須包含：
1. FB 4:5 直式銷售圖卡
2. 台灣房仲銷售圖卡版面
3. 已確認物件主標
4. 已確認賣點
5. 已確認價格；若價格未確認，不得放價格
6. 已確認地址；若地址未確認，不得顯示完整地址
7. 店家認證後帶入的揭露資料
8. 已確認聯絡資訊
9. 人物照規則
10. QR Code 規則
11. 房屋照片使用規則
12. 圖片生成禁止事項

人物照規則：
- 若有提供人物照，保持真人五官、臉型、身形比例與自然表情
- 不得變形
- 不得重畫
- 不得卡通化，除非使用者明確要求
- 未提供人物照時，不得生成虛構人物

QR Code 規則：
- 若有提供 QR Code，必須預留 QR Code 放置區
- QR Code 不得變形、模糊或被遮擋
- 必須保持可掃描
- 未提供 QR Code 時，不得生成假的 QR Code

房屋照片規則：
- 只能使用使用者上傳的房屋照片
- 不得憑空生成不存在的室內照、外觀照或街景
- 不得改變房屋格局、外觀或裝潢重點

完成 finalImagePrompt 後，才可以呼叫 saveImagePackage。
saveImagePackage 只能儲存文字包，不得儲存圖片。
`,

  image_generation_failsafe: `
# 圖片生成防呆規則

你現在的任務是進入圖片生成前最後檢查。

圖片生成必須遵守：
1. FB 4:5 直式版面
2. 只使用已確認資料
3. 不新增未確認資訊
4. 不變形人物
5. 不重畫 QR Code
6. 預留 QR Code 放置區
7. 文字清楚可讀
8. 不產生亂碼
9. 不產生不存在的建物、室內照或街景
10. 不遮擋房屋照片、揭露資訊、聯絡資訊

若生成結果出現以下問題，必須提醒使用者重新生成或修正：
- 人物變形
- QR Code 不可掃描
- 文字錯誤
- 地址錯誤
- 價格錯誤
- 虛構房屋
- 錯誤公司資訊
- 揭露資訊缺漏
`,
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const stage = body?.stage as Stage | undefined;

    if (!stage) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing required field: stage",
          allowedStages: Object.keys(STAGE_RULES),
        },
        { status: 400 }
      );
    }

    if (!(stage in STAGE_RULES)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid stage: ${stage}`,
          allowedStages: Object.keys(STAGE_RULES),
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      stage,
      rules: STAGE_RULES[stage],
      version: "1.0.0",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid request body",
      },
      { status: 400 }
    );
  }
}