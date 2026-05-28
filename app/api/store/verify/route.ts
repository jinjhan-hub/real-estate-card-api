import { supabaseAdmin } from "@/lib/supabaseAdmin";

type VerifyStoreBody = {
  storeId?: string;
  accessCode?: string;
};

type StoreRecord = {
  store_id: string;
  store_name: string | null;
  access_code: string | null;
  active: boolean | null;
  start_at: string | null;
  expires_at: string | null;
  brokerage_name: string | null;
  broker_name: string | null;
  broker_license_no: string | null;
  features: unknown;
};

function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeDateOnly(value: string | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

function getTodayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function getFeatures(features: unknown) {
  return Array.isArray(features)
    ? features.filter((feature): feature is string => typeof feature === "string")
    : [];
}

function hasCompleteDisclosure(store: StoreRecord) {
  return Boolean(
    store.brokerage_name?.trim() &&
      store.broker_name?.trim() &&
      store.broker_license_no?.trim()
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VerifyStoreBody;
    const storeId = body.storeId?.trim();
    const accessCode = body.accessCode?.trim();

    if (!storeId || !accessCode) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          error: "MISSING_STORE_ID_OR_ACCESS_CODE",
          message: "Missing storeId or accessCode.",
        },
        400
      );
    }

    const { data: store, error } = await supabaseAdmin
      .from("stores")
      .select(
        "store_id, store_name, access_code, active, start_at, expires_at, brokerage_name, broker_name, broker_license_no, features"
      )
      .eq("store_id", storeId)
      .maybeSingle<StoreRecord>();

    if (error) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          error: "STORE_LOOKUP_FAILED",
          message: "Failed to verify store.",
          detail: error.message,
        },
        500
      );
    }

    if (!store) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          error: "STORE_NOT_FOUND",
          message: "Store not found.",
        },
        404
      );
    }

    if (store.access_code !== accessCode) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          error: "INVALID_ACCESS_CODE",
          message: "Invalid accessCode.",
        },
        401
      );
    }

    if (store.active !== true) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          error: "STORE_INACTIVE",
          message: "Store is inactive.",
        },
        403
      );
    }

    const today = getTodayDateOnly();
    const startAt = normalizeDateOnly(store.start_at);
    const expiresAt = normalizeDateOnly(store.expires_at);

    if (!startAt || startAt > today) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          error: "STORE_NOT_STARTED",
          message: "Store access has not started.",
        },
        403
      );
    }

    if (!expiresAt || expiresAt < today) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          error: "STORE_EXPIRED",
          message: "Store access has expired.",
        },
        403
      );
    }

    const features = getFeatures(store.features);

    if (!features.includes("sales_card")) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          error: "FEATURE_NOT_ALLOWED",
          message: "sales_card feature is not enabled.",
        },
        403
      );
    }

    if (!hasCompleteDisclosure(store)) {
      return jsonResponse(
        {
          ok: false,
          success: false,
          error: "DISCLOSURE_INCOMPLETE",
          message: "Store disclosure is incomplete.",
        },
        403
      );
    }

    return jsonResponse({
      ok: true,
      success: true,
      store: {
        storeId: store.store_id,
        storeName: store.store_name,
        brokerageName: store.brokerage_name,
        brokerName: store.broker_name,
        brokerLicenseNo: store.broker_license_no,
        features,
        expiresAt: store.expires_at,
      },
      disclosure: {
        brokerageName: store.brokerage_name,
        brokerName: store.broker_name,
        brokerLicenseNo: store.broker_license_no,
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        success: false,
        error: "INTERNAL_SERVER_ERROR",
        message: "Unexpected verifyStore error.",
        detail: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
