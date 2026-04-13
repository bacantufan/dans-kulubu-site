import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

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
      attendance_date,
      ticket_quantity,
      attendee_names,
      rep,
      receipt_note,
      receipt_path,
      receipt_file_name,
      receipt_file_mime,
      consent_approved
    } = body || {};

    const requiredFields = [
      ["full_name", full_name],
      ["phone", phone],
      ["email", email],
      ["attendance_date", attendance_date],
      ["rep", rep],
      ["receipt_note", receipt_note],
      ["receipt_path", receipt_path],
      ["receipt_file_name", receipt_file_name],
      ["receipt_file_mime", receipt_file_mime]
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

    const quantity = Number(ticket_quantity || 1);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5) {
      return sendJson(res, 400, {
        success: false,
        error: "Bilet adedi 1 ile 5 arasında olmalıdır."
      });
    }

    const extraAttendeeNames = Array.isArray(attendee_names) ? attendee_names : [];

    if (quantity > 1 && extraAttendeeNames.length !== quantity - 1) {
      return sendJson(res, 400, {
        success: false,
        error: "Ek katılımcı isimleri eksik girildi."
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const mailFrom = process.env.MAIL_FROM;
    const publicBaseUrl = process.env.PUBLIC_BASE_URL;
    const sheetsWebhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;

    if (!supabaseUrl || !serviceRoleKey) {
      return sendJson(res, 500, { success: false, error: "Supabase environment variable eksik." });
    }

    if (!resendApiKey || !mailFrom || !publicBaseUrl) {
      return sendJson(res, 500, { success: false, error: "Resend environment variable eksik." });
    }

    const emailLower = email.trim().toLowerCase();
    const trimmedDate = attendance_date.trim();

    const existingResponse = await fetch(
      `${supabaseUrl}/rest/v1/registrations?select=id&email=eq.${encodeURIComponent(emailLower)}&attendance_date=eq.${encodeURIComponent(trimmedDate)}&limit=1`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "Content-Type": "application/json"
        }
      }
    );

    if (!existingResponse.ok) {
      const existingText = await existingResponse.text();
      return sendJson(res, 500, {
        success: false,
        error: `Kayıt kontrolü başarısız: ${existingText}`
      });
    }

    const existingRows = await existingResponse.json();

    if (Array.isArray(existingRows) && existingRows.length > 0) {
      return sendJson(res, 400, {
        success: false,
        error: "Aynı e-posta adresi ile aynı güne ikinci kez bilet alınamaz. Farklı bir gün seçebilirsiniz."
      });
    }

    const dayCode = getDayCode(trimmedDate);
    const orderCode = `ORD-${dayCode}-${randomCode(6)}`;

    const insertPayload = Array.from({ length: quantity }, (_, index) => {
      const attendeeName =
        index === 0 ? full_name.trim() : String(extraAttendeeNames[index - 1] || "").trim();

      return {
        ticket_code: `MRM-${dayCode}-${randomCode(6)}`,
        order_code: orderCode,
        full_name: full_name.trim(),
        attendee_name: attendeeName,
        phone: phone.trim(),
        email: emailLower,
        attendance_date: trimmedDate,
        ticket_quantity: quantity,
        ticket_index: index + 1,
        rep: rep.trim(),
        receipt_note: receipt_note.trim(),
        receipt_path: receipt_path.trim(),
        receipt_file_name: receipt_file_name.trim(),
        receipt_file_mime: receipt_file_mime.trim(),
        consent_approved: true,
        status: "REGISTERED",
        emailed: false,
        checked_in: false
      };
    });

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

    const rawInsertText = await insertResponse.text();

    if (!insertResponse.ok) {
      return sendJson(res, 500, {
        success: false,
        error: `Veritabanına kayıt başarısız: ${rawInsertText}`
      });
    }

    const insertedRows = JSON.parse(rawInsertText);

    const tickets = insertedRows.map((row) => ({
      ticketCode: row.ticket_code,
      ticketIndex: row.ticket_index,
      attendeeName: row.attendee_name,
      qrImageUrl: `${publicBaseUrl}/api/qr?ticket=${encodeURIComponent(row.ticket_code)}`,
      ticketPageUrl: `${publicBaseUrl}/ticket-view.html?code=${encodeURIComponent(row.ticket_code)}`
    }));

    const emailHtml = buildTicketEmail({
      fullName: full_name.trim(),
      attendanceDate: trimmedDate,
      orderCode,
      quantity,
      tickets
    });

    let emailError = null;

    try {
      const emailResult = await resend.emails.send({
        from: mailFrom,
        to: [emailLower],
        subject: `Muhteşem Renkler Müzikali Biletlerin • ${trimmedDate}`,
        html: emailHtml
      });

      if (emailResult && emailResult.error) {
        emailError = emailResult.error;
      }
    } catch (err) {
      emailError = err;
    }

    for (const row of insertedRows) {
      await updateRegistrationStatus({
        supabaseUrl,
        serviceRoleKey,
        ticketCode: row.ticket_code,
        emailed: !emailError,
        status: emailError ? "EMAIL_FAILED" : "EMAIL_SENT"
      });
    }

    if (sheetsWebhookUrl) {
      try {
        for (const row of insertedRows) {
          await fetch(sheetsWebhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              order_code: row.order_code || orderCode,
              ticket_quantity: row.ticket_quantity || quantity,
              ticket_index: row.ticket_index,
              ticket_code: row.ticket_code,
              attendee_name: row.attendee_name || "",
              full_name: row.full_name,
              phone: row.phone,
              email: row.email,
              attendance_date: row.attendance_date,
              rep: row.rep,
              receipt_note: row.receipt_note,
              receipt_path: row.receipt_path,
              receipt_url: `${publicBaseUrl}/api/receipt-link?path=${encodeURIComponent(row.receipt_path)}`,
              status: emailError ? "EMAIL_FAILED" : "EMAIL_SENT",
              emailed: !emailError,
              checked_in: false
            })
          });
        }
      } catch (sheetError) {
        console.error("SHEETS WEBHOOK ERROR:", sheetError);
      }
    }

    return sendJson(res, 200, {
      success: true,
      message: emailError
        ? "Kayıt oluşturuldu ancak e-posta gönderimi başarısız oldu."
        : "Kayıt oluşturuldu ve bilet e-postası gönderildi.",
      order_code: orderCode,
      attendance_date: trimmedDate,
      ticket_quantity: quantity
    });
  } catch (error) {
    console.error("REGISTER API ERROR:", error);
    return sendJson(res, 500, {
      success: false,
      error: error.message || "Beklenmeyen bir hata oluştu."
    });
  }
}

async function updateRegistrationStatus({
  supabaseUrl,
  serviceRoleKey,
  ticketCode,
  emailed,
  status
}) {
  await fetch(
    `${supabaseUrl}/rest/v1/registrations?ticket_code=eq.${encodeURIComponent(ticketCode)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        emailed,
        status
      })
    }
  );
}

function buildTicketEmail({ fullName, attendanceDate, orderCode, quantity, tickets }) {
  const ticketCards = tickets.map((ticket) => `
    <div style="margin-top:18px;border-radius:24px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);overflow:hidden;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td valign="top" style="padding:22px;border-right:1px dashed rgba(255,255,255,.12);width:55%;">
            <div style="font-size:12px;color:#f4c56c;text-transform:uppercase;letter-spacing:.14em;font-weight:700;margin-bottom:12px;">
              Bilet ${ticket.ticketIndex}
            </div>

            <div style="margin-bottom:16px;">
              <div style="color:#8f94a8;font-size:12px;margin-bottom:4px;">Bilet Sahibi</div>
              <div style="color:#ffffff;font-size:16px;font-weight:700;">${escapeHtml(ticket.attendeeName)}</div>
            </div>

            <div style="margin-bottom:16px;">
              <div style="color:#8f94a8;font-size:12px;margin-bottom:4px;">Temsil Günü</div>
              <div style="color:#ffffff;font-size:16px;font-weight:700;">${escapeHtml(attendanceDate)}</div>
            </div>

            <div style="margin-bottom:16px;">
              <div style="color:#8f94a8;font-size:12px;margin-bottom:4px;">Bilet Kodu</div>
              <div style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:.08em;">${escapeHtml(ticket.ticketCode)}</div>
            </div>
          </td>

          <td valign="top" style="padding:22px;text-align:center;background:rgba(255,255,255,.03);width:45%;">
            <div style="font-size:12px;color:#f4c56c;text-transform:uppercase;letter-spacing:.14em;font-weight:700;margin-bottom:12px;">
              QR Giriş Kodu
            </div>

            <div style="display:inline-block;background:#ffffff;padding:14px;border-radius:20px;">
              <img src="${ticket.qrImageUrl}" alt="QR Kod" width="220" height="220" style="display:block;width:220px;height:220px;border:0;outline:none;text-decoration:none;" />
            </div>

            <div style="margin-top:14px;text-align:center;">
              <a href="${ticket.ticketPageUrl}" style="display:inline-block;padding:12px 16px;border-radius:14px;background:#f4c56c;color:#17120a;font-weight:800;text-decoration:none;">
                Biletimi Gör
              </a>
            </div>
          </td>
        </tr>
      </table>
    </div>
  `).join("");

  return `
  <div style="margin:0;padding:0;background:#0b0c12;font-family:Inter,Arial,sans-serif;color:#f7f3ea;">
    <div style="max-width:760px;margin:0 auto;padding:32px 16px;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;padding:8px 14px;border-radius:999px;background:#1a1c25;color:#f4c56c;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">
          YUDANSK Bilet
        </div>
      </div>

      <div style="border-radius:28px;overflow:hidden;background:linear-gradient(135deg,#141626 0%,#0e1018 55%,#17111d 100%);border:1px solid rgba(255,255,255,.08);box-shadow:0 20px 50px rgba(0,0,0,.35);">
        <div style="padding:28px 24px 18px;background:radial-gradient(circle at top left, rgba(245,83,153,.18), transparent 30%),radial-gradient(circle at top right, rgba(143,107,255,.18), transparent 30%);">
          <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#f4c56c;font-weight:700;margin-bottom:10px;">
            Muhteşem Renkler Müzikali
          </div>
          <h1 style="margin:0;font-size:34px;line-height:1;color:#ffffff;letter-spacing:-.04em;">
            Biletlerin Hazır
          </h1>
          <p style="margin:14px 0 0;color:#c9bfd8;font-size:15px;line-height:1.7;">
            Merhaba ${escapeHtml(fullName)}, başvurun başarıyla tamamlandı. Aşağıda siparişine ait ${quantity} adet bilet ve QR kodları yer alıyor. QR görseli mail içinde görünmüyorsa her bilet için “Biletimi Gör” bağlantısını kullanabilirsin.
          </p>

          <div style="margin-top:18px;padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);">
            <div style="margin-bottom:10px;">
              <div style="color:#8f94a8;font-size:12px;margin-bottom:4px;">Sipariş Kodu</div>
              <div style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:.08em;">${escapeHtml(orderCode)}</div>
            </div>

            <div style="margin-bottom:10px;">
              <div style="color:#8f94a8;font-size:12px;margin-bottom:4px;">Temsil Günü</div>
              <div style="color:#ffffff;font-size:16px;font-weight:700;">${escapeHtml(attendanceDate)}</div>
            </div>

            <div>
              <div style="color:#8f94a8;font-size:12px;margin-bottom:4px;">Toplam Bilet</div>
              <div style="color:#ffffff;font-size:16px;font-weight:700;">${quantity}</div>
            </div>
          </div>
        </div>

        <div style="padding:18px 24px 28px;">
          ${ticketCards}

          <div style="margin-top:18px;padding:16px 18px;border-radius:18px;background:rgba(244,197,108,.08);border:1px solid rgba(244,197,108,.18);color:#f3e4bf;font-size:13px;line-height:1.7;">
            Bu e-posta otomatik olarak oluşturulmuştur. Etkinlik günü değişikliği veya destek taleplerin için YUDANSK organizasyon ekibiyle iletişime geçebilirsin.
          </div>
        </div>
      </div>
    </div>
  </div>
  `;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
