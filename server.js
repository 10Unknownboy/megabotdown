import express from "express";
import morgan from "morgan";
import helmet from "helmet";
import { File } from "megajs";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(morgan("tiny"));

/**
 * Simple host allowlist: only accept mega.nz / mega.co.nz links.
 */
function isAllowedMegaLink(str) {
  try {
    const u = new URL(str);
    return ["mega.nz", "www.mega.nz", "mega.co.nz", "www.mega.co.nz"].includes(u.hostname)
           && (u.pathname.startsWith("/file/") || u.pathname.startsWith("/#!") || u.pathname.startsWith("/f/") === false);
    // NOTE: this endpoint supports public FILE links. Folder links are not supported here.
  } catch {
    return false;
  }
}

/**
 * Parse "Range: bytes=start-end"
 */
function parseRange(rangeHeader, size) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;
  const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
  let start = startStr ? parseInt(startStr, 10) : 0;
  let end = endStr ? parseInt(endStr, 10) : size - 1;
  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end) || end >= size) end = size - 1;
  if (start > end || start < 0) return null;
  return { start, end };
}

/**
 * Health check
 */
app.get("/", (_req, res) => {
  res
    .status(200)
    .type("text/plain")
    .send("MEGA direct proxy is up. Use /dl?link=<MEGA_PUBLIC_FILE_URL>");
});

/**
 * One-click download endpoint
 * Example: /dl?link=https%3A%2F%2Fmega.nz%2Ffile%2FXXXX#KEY
 */
app.get("/dl", async (req, res) => {
  const megaLink = req.query.link;

  if (!megaLink) {
    return res.status(400).send("Missing ?link=<MEGA_PUBLIC_FILE_URL>");
  }
  if (!isAllowedMegaLink(megaLink)) {
    return res.status(400).send("Only public MEGA FILE links are supported.");
  }

  try {
    // Construct file from public link and load metadata
    const file = File.fromURL(megaLink);
    await file.loadAttributes(); // fetches name/size

    const fileName = file.name || "download.bin";
    const fileSize = Number(file.size);

    // Basic headers common to full and partial content
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");

    // Handle range requests (resume support)
    const range = parseRange(req.headers.range, fileSize);

    if (range) {
      const { start, end } = range;
      const chunkSize = end - start + 1;

      res.status(206); // Partial Content
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Content-Length", String(chunkSize));

      // Stream only the requested byte range
      // megajs supports ranged downloads via { start, end }
      file.download({ start, end }).pipe(res);
    } else {
      // Full file
      res.status(200);
      if (Number.isFinite(fileSize)) {
        res.setHeader("Content-Length", String(fileSize));
      }
      res.setHeader("Content-Type", "application/octet-stream");

      // Stream the entire file
      file.download().pipe(res);
    }
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).send("Failed to fetch from MEGA. Check the link and try again.");
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
