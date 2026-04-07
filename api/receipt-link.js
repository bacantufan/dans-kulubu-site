import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    const { path } = req.query || {};

    if (!path) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end("path parametresi zorunlu.");
    }

    const { data, error } = await supabase.storage
      .from("receipts")
      .createSignedUrl(path, 60 * 5);

    if (error || !data?.signedUrl) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(error?.message || "Dekont linki üretilemedi.");
    }

    res.statusCode = 302;
    res.setHeader("Location", data.signedUrl);
    return res.end();
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(error.message || "Beklenmeyen hata.");
  }
}
