export async function GET() {
  return Response.json({
    ok: true,
    service: "real-estate-card-api",
    version: "1.0.0",
  });
}