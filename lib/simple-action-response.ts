export function simpleActionResponse({
  ok = true,
  success = true,
  sessionId,
  currentStage,
  nextStage,
  nextAction,
  mustCallNext,
  requiredStage = "",
  message = "OK",
  error = ""
}: {
  ok?: boolean;
  success?: boolean;
  sessionId: string;
  currentStage: string;
  nextStage: string;
  nextAction: string;
  mustCallNext: string;
  requiredStage?: string;
  message?: string;
  error?: string;
}) {
  const body: Record<string, unknown> = {
    ok,
    success,
    sessionId,
    currentStage,
    nextStage,
    nextAction,
    mustCallNext,
    requiredStage,
    message
  };

  if (error) {
    body.error = error;
  }

  return Response.json(body, {
    status: ok ? 200 : 409
  });
}
