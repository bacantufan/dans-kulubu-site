export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const checkinPassword = process.env.CHECKIN_PASSWORD;

  if (!supabaseUrl || !serviceRoleKey || !checkinPassword) {
    return sendJson(res, 500, {
      success: false,
      error: "Server environment variable eksik."
    });
  }

  const providedPassword = String(req.headers["x-checkin-password"] || "").trim();

  if (providedPassword !== checkinPassword) {
    return sendJson(res, 401, {
      success: false,
      error: "Yetkisiz erişim."
    });
  }

  try {
    if (req.method === "GET") {
      const mode = String(req.query?.mode || "").trim();
      const selectedDay = String(req.query?.selected_day || "").trim();

      if (mode === "stats") {
        if (!selectedDay) {
          return sendJson(res, 400, { success: false, error: "selected_day zorunlu." });
        }

        const response = await fetch(
          `${supabaseUrl}/rest/v1/registrations?select=id&attendance_date=eq.${encodeURIComponent(selectedDay)}&checked_in=is.true`,
          {
            method: "GET",
            headers: buildHeaders(serviceRoleKey)
          }
        );

        const rawText = await response.text();

        if (!response.ok) {
          return sendJson(res, 500, {
            success: false,
            error: rawText || "İstatistik alınamadı."
          });
        }

        const rows = JSON.parse(rawText);

        return sendJson(res, 200, {
          success: true,
          checked_in_count: Array.isArray(rows) ? rows.length : 0
        });
      }

      const rawCode = String(req.query?.code || "").trim();
      const code = normalizeScannedValue(rawCode);

      if (!code) {
        return sendJson(res, 400, {
          success: false,
          error: "Bilet kodu zorunlu."
        });
      }

      const response = await fetch(
        `${supabaseUrl}/rest/v1/registrations?select=id,ticket_code,attendee_name,full_name,attendance_date,status,checked_in,checked_in_at,checked_in_by,order_code,ticket_index&ticket_code=eq.${encodeURIComponent(code)}&limit=1`,
        {
          method: "GET",
          headers: buildHeaders(serviceRoleKey)
        }
      );

      const rawText = await response.text();

      if (!response.ok) {
        return sendJson(res, 500, {
          success: false,
          error: rawText || "Bilet sorgulanamadı."
        });
      }

      const rows = JSON.parse(rawText);

      if (!Array.isArray(rows) || rows.length === 0) {
        return sendJson(res, 404, {
          success: false,
          error: "Bilet bulunamadı."
        });
      }

      const ticket = rows[0];

      if (ticket.status === "CANCELLED") {
        return sendJson(res, 400, {
          success: false,
          error: "Bu bilet iptal edilmiş.",
          reason: "cancelled",
          ticket
        });
      }

      if (selectedDay && ticket.attendance_date !== selectedDay) {
        return sendJson(res, 400, {
          success: false,
          error: `Bu bilet ${ticket.attendance_date} için geçerli. Seçili gün: ${selectedDay}.`,
          reason: "wrong_day",
          ticket
        });
      }

      if (ticket.checked_in === true) {
        return sendJson(res, 400, {
          success: false,
          error: "Bu bilet daha önce kullanılmış.",
          reason: "already_used",
          ticket
        });
      }

      return sendJson(res, 200, {
        success: true,
        ticket
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const rawCode = String(body?.code || "").trim();
      const code = normalizeScannedValue(rawCode);
      const checkedInBy = String(body?.checked_in_by || "").trim();
      const selectedDay = String(body?.selected_day || "").trim();

      if (!code) {
        return sendJson(res, 400, {
          success: false,
          error: "Bilet kodu zorunlu."
        });
      }

      const lookupResponse = await fetch(
        `${supabaseUrl}/rest/v1/registrations?select=id,ticket_code,attendee_name,full_name,attendance_date,status,checked_in,checked_in_at,checked_in_by&ticket_code=eq.${encodeURIComponent(code)}&limit=1`,
        {
          method: "GET",
          headers: buildHeaders(serviceRoleKey)
        }
      );

      const lookupText = await lookupResponse.text();

      if (!lookupResponse.ok) {
        return sendJson(res, 500, {
          success: false,
          error: lookupText || "Bilet kontrol edilemedi."
        });
      }

      const rows = JSON.parse(lookupText);

      if (!Array.isArray(rows) || rows.length === 0) {
        return sendJson(res, 404, {
          success: false,
          error: "Bilet bulunamadı."
        });
      }

      const ticket = rows[0];

      if (ticket.status === "CANCELLED") {
        return sendJson(res, 400, {
          success: false,
          error: "Bu bilet iptal edilmiş.",
          reason: "cancelled",
          ticket
        });
      }

      if (selectedDay && ticket.attendance_date !== selectedDay) {
        return sendJson(res, 400, {
          success: false,
          error: `Bu bilet ${ticket.attendance_date} için geçerli. Seçili gün: ${selectedDay}.`,
          reason: "wrong_day",
          ticket
        });
      }

      if (ticket.checked_in === true) {
        return sendJson(res, 400, {
          success: false,
          error: "Bu bilet daha önce kullanılmış.",
          reason: "already_used",
          ticket
        });
      }

      const patchResponse = await fetch(
        `${supabaseUrl}/rest/v1/registrations?ticket_code=eq.${encodeURIComponent(code)}`,
        {
          method: "PATCH",
          headers: buildHeaders(serviceRoleKey),
          body: JSON.stringify({
            checked_in: true,
            checked_in_at: new Date().toISOString(),
            checked_in_by: checkedInBy || null
          })
        }
      );

      const patchText = await patchResponse.text();

      if (!patchResponse.ok) {
        return sendJson(res, 500, {
          success: false,
          error: patchText || "Check-in güncellenemedi."
        });
      }

      return sendJson(res, 200, {
        success: true,
        message: "Giriş başarıyla onaylandı."
      });
    }

    return sendJson(res, 405, {
      success: false,
      error: "Sadece GET ve POST destekleniyor."
    });
  } catch (error) {
    return sendJson(res, 500, {
      success: false,
      error: error.message || "Beklenmeyen hata."
    });
  }
}

function buildHeaders(serviceRoleKey) {
  return {
    Authorization: `Bearer ${serviceRoleKey}`,
    apikey: serviceRoleKey,
    "Content-Type": "application/json"
  };
}

function normalizeScannedValue(value = "") {
  const raw = String(value).trim();
  if (!raw) return "";

  // QR bazen doğrudan ticket code, bazen ticket-view linki olabilir
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const url = new URL(raw);
      const code = url.searchParams.get("code");
      if (code) return code.trim();
    } catch (e) {}
  }

  return raw;
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
  return raw ? JSON.parse(raw) : {};
}
