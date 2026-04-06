import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { success: false, error: "Sadece POST destekleniyor." });
  }

  try {
    const body = await readJsonBody(req);
    const { file_name, file_type, attendance_date } = body || {};

    if (!file_name || !file_type || !attendance_date) {
      return sendJson(res, 400, {
        success: false,
        error: "file_name, file_type ve attendance_date zorunlu."
      });
    }

    const allowedDates = new Set(["21 Nisan", "22 Nisan", "23 Nisan", "24 Nisan"]);
    if (!allowedDates.has(attendance_date)) {
      return sendJson(res, 400, { success: false, error: "Geçersiz temsil günü." });
    }

    const allowedTypes = new Set(["image/jpeg", "image/png", "application/pdf"]);
    if (!allowedTypes.has(file_type)) {
      return sendJson(res, 400, {
        success: false,
        error: "Sadece JPG, PNG veya PDF yükleyebilirsin."
      });
    }

    const safeFileName = sanitizeFileName(file_name);
    const dayFolder = attendance_date.replace(/\s+/g, "-");
    const uniquePrefix = `${Date.now()}-${randomCode(6)}`;
    const path = `${dayFolder}/${uniquePrefix}-${safeFileName}`;

    const { data, error } = await supabase.storage
      .from("receipts")
      .createSignedUploadUrl(path);

    if (error) {
      return sendJson(res, 500, {
        success: false,
        error: error.message || "Signed upload URL oluşturulamadı."
      });
    }

    return sendJson(res, 200, {
      success: true,
      path: path,
      token: data.token
    });
  } catch (error) {
    return sendJson(res, 500, {
      success: false,
      error: error.message || "Beklenmeyen bir hata oluştu."
    });
  }
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function randomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let output = "";
  for (let i = 0; i < length; i++) {
    output += chars[Math.floor(Math.random() * chars.length)];
  }
  return output;
}

function sanitizeFileName(name = "receipt") {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
