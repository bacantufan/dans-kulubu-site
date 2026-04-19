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

  add(path);

  try {
    add(decodeURIComponent(path));
  } catch (e) {}

  const variants = [
    ["21 Nisan/", "21-Nisan/"],
    ["22 Nisan/", "22-Nisan/"],
    ["23 Nisan/", "23-Nisan/"],
    ["24 Nisan/", "24-Nisan/"],

    ["21-Nisan/", "21 Nisan/"],
    ["22-Nisan/", "22 Nisan/"],
    ["23-Nisan/", "23 Nisan/"],
    ["24-Nisan/", "24 Nisan/"],

    ["April-22/", "22-Nisan/"],
    ["April-23/", "23-Nisan/"],
    ["April-24/", "24-Nisan/"],

    ["22-Nisan/", "April-22/"],
    ["23-Nisan/", "April-23/"],
    ["24-Nisan/", "April-24/"]
  ];

  const baseValues = [path];
  try {
    baseValues.push(decodeURIComponent(path));
  } catch (e) {}

  for (const base of baseValues) {
    add(base);
    add(base.replace(/\s+/g, "-"));

    for (const [from, to] of variants) {
      if (base.includes(from)) {
        add(base.replace(from, to));
      }
    }
  }

  return Array.from(candidates);
}
