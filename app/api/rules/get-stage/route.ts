const GITHUB_RULE_BASE_URL =
  "https://raw.githubusercontent.com/jinjhan-hub/real-estate-gpt-knowledge/main/fb_card/stage_rules/lite-v1";

const ALLOWED_STAGES = [
  "material_check",
  "property_extract",
  "compliance_check",
  "style_selection",
  "image_prompt",
  "final_generation_brief",
  "manual_review",
] as const;

type Stage = (typeof ALLOWED_STAGES)[number];

type GetStageRulesBody = {
  stage?: string;
};

function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function isAllowedStage(stage: string): stage is Stage {
  return ALLOWED_STAGES.includes(stage as Stage);
}

async function fetchStageRule(stage: Stage) {
  const response = await fetch(`${GITHUB_RULE_BASE_URL}/${stage}.md`, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "text/markdown; charset=utf-8, text/plain; charset=utf-8",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load stage rule: ${stage}`);
  }

  const buffer = await response.arrayBuffer();
  return new TextDecoder("utf-8").decode(buffer);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GetStageRulesBody;
    const stage = body.stage?.trim();

    if (!stage) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          error: "MISSING_STAGE",
          message: "Missing stage.",
        },
        400
      );
    }

    if (!isAllowedStage(stage)) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          error: "INVALID_STAGE",
          message: "Stage is not allowed for Lite rules.",
          allowedStages: ALLOWED_STAGES,
        },
        400
      );
    }

    const content = await fetchStageRule(stage);

    return jsonResponse({
      ok: true,
      success: true,
      stage,
      content,
      source: "github",
      version: "lite-v1",
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        success: false,
        error: "STAGE_RULE_LOAD_FAILED",
        message: "Failed to load Lite stage rule.",
        detail: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
