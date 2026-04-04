import QRCode from "qrcode";

export default async function handler(req, res) {
  try {
    const { ticket } = req.query || {};

    if (!ticket) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end("ticket parametresi zorunlu.");
    }

    const qrText = `${process.env.PUBLIC_BASE_URL}/checkin?ticket=${encodeURIComponent(ticket)}`;

    const qrBuffer = await QRCode.toBuffer(qrText, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 500
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.end(qrBuffer);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("QR oluşturulamadı.");
  }
}
