export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { success: false, error: "Sadece POST destekleniyor." });
  }

  try {
    const body = await readJsonBody(req);

    const {
      full_name,
      phone,
      email,
      university,
      department,
      class_level,
      attendance_date,
      rep,
      receipt_note,
      receipt_file_name,
      receipt_file_mime,
      receipt_file_base64,
      consent_approved
    } = body || {};

    const requiredFields = [
      ["full_name", full_name],
      ["phone", phone],
      ["email", email],
      ["university", university],
      ["department", department],
      ["class_level", class_level],
      ["attendance_date", attendance_date],
      ["rep", rep],
      ["receipt_note", receipt_note],
      ["receipt_file_name", receipt_file_name],
      ["receipt_file_mime", receipt_file_mime],
      ["receipt_file_base64", receipt_file_base64]
    ];

    for (const [key, value] of requiredFields) {
      if (!value || String(value).trim() === "") {
        return sendJson(res, 400, { success: false, error: `${key} alanı zorunlu.` });
      }
    }

    if (consent_approved !== true) {
      return sendJson(res, 400, { success: false, error: "Onay kutusu zorunlu." });
    }

    const allowedDates = new Set(["21 Nisan", "22 Nisan", "23 Nisan", "24 Nisan"]);
    if (!allowedDates.has(attendance_date)) {
      return sendJson(res, 400, { success: false, error: "Geçersiz temsil günü." });
    }

    const allowedMimes = new Set(["image/jpeg", "image/png", "application/pdf"]);
    if (!allowedMimes.has(receipt_file_mime)) {
      return sendJson(res, 400, { success: false, error: "Sadece JPG, PNG veya PDF yükleyebilirsin." });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return sendJson(res, 500, { success: false, error: "Supabase environment variable eksik." });
    }

    const dayCode = getDayCode(attendance_date);
    const ticketCode = `MRM-${dayCode}-${randomCode(6)}`;

    const base64Only = receipt_file_base64.includes(",")
      ? receipt_file_base64.split(",")[1]
      : receipt_file_base64;

    const fileBuffer = Buffer.from(base64Only, "base64");

    const safeFileName = sanitizeFileName(receipt_file_name);
    const receiptPath = `${attendance_date.replace(/\s+/g, "-")}/${ticketCode}-${safeFileName}`;
    const encodedReceiptPath = receiptPath.split("/").map(encodeURIComponent).join("/");

    const uploadResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/receipts/${encodedReceiptPath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "Content-Type": receipt_file_mime,
          "x-upsert": "false"
        },
        body: fileBuffer
      }
    );

    if (!uploadResponse.ok) {
      const uploadText = await uploadResponse.text();
      return sendJson(res, 500, {
        success: false,
        error: `Dekont yükleme başarısız: ${uploadText}`
      });
    }

    const insertPayload = {
      ticket_code: ticketCode,
      full_name: full_name.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      university: university.trim(),
      department: department.trim(),
      class_level: class_level.trim(),
      attendance_date: attendance_date.trim(),
      rep: rep.trim(),
      receipt_note: receipt_note.trim(),
      receipt_path: receiptPath,
      receipt_file_name: receipt_file_name.trim(),
      receipt_file_mime: receipt_file_mime.trim(),
      consent_approved: true,
      status: "REGISTERED",
      emailed: false,
      checked_in: false
    };

    const insertResponse = await fetch(`${supabaseUrl}/rest/v1/registrations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(insertPayload)
    });

    if (!insertResponse.ok) {
      const insertText = await insertResponse.text();
      return sendJson(res, 500, {
        success: false,
        error: `Veritabanına kayıt başarısız: ${insertText}`
      });
    }

    return sendJson(res, 200, {
      success: true,
      message: "Kayıt oluşturuldu.",
      ticket_code: ticketCode,
      attendance_date
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

  for await (const chunk of req) {
    raw += chunk;
  }

  if (!raw) return {};
  return JSON.parse(raw);
}

function randomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let output = "";

  for (let i = 0; i < length; i++) {
    output += chars[Math.floor(Math.random() * chars.length)];
  }

  return output;
}

function getDayCode(attendanceDate) {
  const map = {
    "21 Nisan": "21NIS",
    "22 Nisan": "22NIS",
    "23 Nisan": "23NIS",
    "24 Nisan": "24NIS"
  };

  return map[attendanceDate] || "DAY";
}

function sanitizeFileName(name = "receipt") {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
