export default async function handler(req, res) {
  try {
    const { code } = req.query || {};

    if (!code) {
      return sendJson(res, 400, {
        success: false,
        error: "Bilet kodu eksik."
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return sendJson(res, 500, {
        success: false,
        error: "Supabase environment variable eksik."
      });
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/registrations?select=ticket_code,attendee_name,full_name,attendance_date,status,checked_in&ticket_code=eq.${encodeURIComponent(code)}&limit=1`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "Content-Type": "application/json"
        }
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
      return sendJson(res, 404, {
        success: false,
        error: "Bu bilet iptal edilmiş."
      });
    }

    return sendJson(res, 200, {
      success: true,
      ticket
    });
  } catch (error) {
    return sendJson(res, 500, {
      success: false,
      error: error.message || "Beklenmeyen hata."
    });
  }
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
