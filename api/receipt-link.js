import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    const rawPath = req.query?.path;

    if (!rawPath) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end("path parametresi zorunlu.");
    }

    const originalPath = String(rawPath).trim();
    const candidatePaths = buildCandidatePaths(originalPath);

    for (const candidatePath of candidatePaths) {
      const { data, error } = await supabase.storage
        .from("receipts")
        .createSignedUrl(candidatePath, 60 * 5);

      if (!error && data?.signedUrl) {
        res.statusCode = 302;
        res.setHeader("Location", data.signedUrl);
        return res.end();
      }
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Object not found");
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(error.message || "Beklenmeyen hata.");
  }
}

function buildCandidatePaths(path) {
  const candidates = new Set();

  const add = (value) => {
    if (value && typeof value === "string") {
      candidates.add(value.trim());
    }
  };

  const tryBase = (base) => {
    add(base);

    const parts = base.split("/");
    if (parts.length < 2) return;

    const folder = parts[0];
    const fileName = parts.slice(1).join("/");

    const folderMap = {
      "21-Nisan": ["21-Nisan"],
      "22-Nisan": ["22-Nisan", "April-22"],
      "23-Nisan": ["23-Nisan", "April-23"],
      "24-Nisan": ["24-Nisan", "April-24"],
      "April-22": ["April-22", "22-Nisan"],
      "April-23": ["April-23", "23-Nisan"],
      "April-24": ["April-24", "24-Nisan"],
      "21 Nisan": ["21 Nisan", "21-Nisan"],
      "22 Nisan": ["22 Nisan", "22-Nisan", "April-22"],
      "23 Nisan": ["23 Nisan", "23-Nisan", "April-23"],
      "24 Nisan": ["24 Nisan", "24-Nisan", "April-24"]
    };

    const variants = folderMap[folder] || [folder];

    for (const variantFolder of variants) {
      add(`${variantFolder}/${fileName}`);
    }
  };

  tryBase(path);

  try {
    tryBase(decodeURIComponent(path));
  } catch (e) {}

  return Array.from(candidates);
}
