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
      university,
      department,
      class_level,
      attendance_date,
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
      ["university", university],
      ["department", department],
      ["class_level", class_level],
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

    const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const mailFrom = process.env.MAIL_FROM;
const publicBaseUrl = process.env.PUBLIC_BASE_URL;
const sheetsWebhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    const signedUrlResponse = await fetch(
  `${supabaseUrl}/storage/v1/object/sign/receipts/${receipt_path.trim()}`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      expiresIn: 60 * 60 * 24 * 30
    })
  }
);

let receiptSignedUrl = "";

if (signedUrlResponse.ok) {
  const signedUrlData = await signedUrlResponse.json();
  if (signedUrlData?.signedURL) {
    receiptSignedUrl = `${supabaseUrl}/storage/v1${signedUrlData.signedURL}`;
  }
}

    if (!supabaseUrl || !serviceRoleKey) {
      return sendJson(res, 500, { success: false, error: "Supabase environment variable eksik." });
    }

    if (!resendApiKey || !mailFrom || !publicBaseUrl) {
      return sendJson(res, 500, { success: false, error: "Resend environment variable eksik." });
    }

    const dayCode = getDayCode(attendance_date);
    const ticketCode = `MRM-${dayCode}-${randomCode(6)}`;

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
      receipt_path: receipt_path.trim(),
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

    const rawText = await insertResponse.text();

    if (!insertResponse.ok) {
      if (rawText.includes("duplicate key value") || rawText.includes("registrations_email_unique")) {
        return sendJson(res, 400, {
          success: false,
          error: "Bu e-posta adresi ile daha önce kayıt oluşturulmuş."
        });
      }

      return sendJson(res, 500, {
        success: false,
        error: `Veritabanına kayıt başarısız: ${rawText}`
      });
    }

    const qrPayload = `${publicBaseUrl}/checkin?ticket=${encodeURIComponent(ticketCode)}`;
    

    const emailHtml = buildTicketEmail({
  fullName: full_name.trim(),
  attendanceDate: attendance_date.trim(),
  ticketCode,
  qrImageUrl: `${publicBaseUrl}/api/qr?ticket=${encodeURIComponent(ticketCode)}`
});

    const { error: emailError } = await resend.emails.send({
  from: mailFrom,
  to: [email.trim().toLowerCase()],
  subject: `Muhteşem Renkler Müzikali Biletin • ${attendance_date}`,
  html: emailHtml
});

    if (emailError) {
      await updateEmailState({
        supabaseUrl,
        serviceRoleKey,
        ticketCode,
        emailed: false,
        status: "EMAIL_FAILED"
      });

      return sendJson(res, 200, {
        success: true,
        ticket_code: ticketCode,
        attendance_date,
        warning: "Kayıt oluşturuldu ancak e-posta gönderimi başarısız oldu."
      });
    }

    await updateEmailState({
      supabaseUrl,
      serviceRoleKey,
      ticketCode,
      emailed: true,
      status: "EMAIL_SENT"
    });
    const sheetsWebhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;

if (sheetsWebhookUrl) {
  await fetch(sheetsWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
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
      receipt_path: receipt_path.trim(),
      receipt_url: receiptSignedUrl,
      status: emailError ? "EMAIL_FAILED" : "EMAIL_SENT",
      emailed: !emailError,
      checked_in: false
    })
  });
}

    return sendJson(res, 200, {
      success: true,
      message: "Kayıt oluşturuldu ve bilet e-postası gönderildi.",
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

async function updateEmailState({ supabaseUrl, serviceRoleKey, ticketCode, emailed, status }) {
  await fetch(`${supabaseUrl}/rest/v1/registrations?ticket_code=eq.${encodeURIComponent(ticketCode)}`, {
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
  });
}

function buildTicketEmail({ fullName, attendanceDate, ticketCode, qrImageUrl }) {
  return `
  <div style="margin:0;padding:0;background:#0b0c12;font-family:Inter,Arial,sans-serif;color:#f7f3ea;">
    <div style="max-width:680px;margin:0 auto;padding:32px 16px;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;padding:8px 14px;border-radius:999px;background:#1a1c25;color:#f4c56c;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">
          YUDANSK Bilet
        </div>
      </div>

      <div style="border-radius:28px;overflow:hidden;background:linear-gradient(135deg,#141626 0%,#0e1018 55%,#17111d 100%);border:1px solid rgba(255,255,255,.08);box-shadow:0 20px 50px rgba(0,0,0,.35);">
        <div style="padding:28px 24px 14px;background:radial-gradient(circle at top left, rgba(245,83,153,.18), transparent 30%),radial-gradient(circle at top right, rgba(143,107,255,.18), transparent 30%);">
          <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#f4c56c;font-weight:700;margin-bottom:10px;">
            Muhteşem Renkler Müzikali
          </div>
          <h1 style="margin:0;font-size:34px;line-height:1;color:#ffffff;letter-spacing:-.04em;">
            Biletin Hazır
          </h1>
          <p style="margin:14px 0 0;color:#c9bfd8;font-size:15px;line-height:1.7;">
            Merhaba ${escapeHtml(fullName)}, başvurun başarıyla tamamlandı. Aşağıdaki bilet ve QR kod ile etkinlik girişini gerçekleştirebilirsin.
          </p>
        </div>

        <div style="padding:18px 24px 28px;">
          <div style="border-radius:24px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);overflow:hidden;">
            <div style="display:grid;grid-template-columns:1.1fr .9fr;">
              <div style="padding:22px;border-right:1px dashed rgba(255,255,255,.12);">
                <div style="font-size:12px;color:#f4c56c;text-transform:uppercase;letter-spacing:.14em;font-weight:700;margin-bottom:12px;">
                  Etkinlik Bilgisi
                </div>

                <div style="margin-bottom:16px;">
                  <div style="color:#8f94a8;font-size:12px;margin-bottom:4px;">Etkinlik</div>
                  <div style="color:#ffffff;font-size:18px;font-weight:700;">Muhteşem Renkler Müzikali</div>
                </div>

                <div style="margin-bottom:16px;">
                  <div style="color:#8f94a8;font-size:12px;margin-bottom:4px;">Temsil Günü</div>
                  <div style="color:#ffffff;font-size:16px;font-weight:700;">${escapeHtml(attendanceDate)}</div>
                </div>

                <div style="margin-bottom:16px;">
                  <div style="color:#8f94a8;font-size:12px;margin-bottom:4px;">Bilet Kodu</div>
                  <div style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:.08em;">${escapeHtml(ticketCode)}</div>
                </div>

                <div>
                  <div style="color:#8f94a8;font-size:12px;margin-bottom:4px;">Giriş Notu</div>
                  <div style="color:#c9bfd8;font-size:14px;line-height:1.6;">
                    Girişte bu QR kodu ve bilet kodunu hazır bulundurman yeterli.
                  </div>
                </div>
              </div>

              <div style="padding:22px;text-align:center;background:rgba(255,255,255,.03);">
                <div style="font-size:12px;color:#f4c56c;text-transform:uppercase;letter-spacing:.14em;font-weight:700;margin-bottom:12px;">
                  QR Giriş Kodu
                </div>

                <div style="display:inline-block;background:#ffffff;padding:14px;border-radius:20px;">
                  <img src="${qrImageUrl}" alt="QR Kod" width="220" height="220" style="display:block;width:220px;height:220px;border:0;outline:none;text-decoration:none;" />
                </div>

                <div style="margin-top:12px;color:#9aa1b5;font-size:12px;line-height:1.6;">
                  QR okutulduğunda bilet kodun doğrulanacaktır.
                </div>
              </div>
            </div>
          </div>

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

function getDayCode(attendanceDate) {
  const map = {
    "21 Nisan": "21NIS",
    "22 Nisan": "22NIS",
    "23 Nisan": "23NIS",
    "24 Nisan": "24NIS"
  };
  return map[attendanceDate] || "DAY";
}
