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
 * Enhanced host allowlist: accept mega.nz / mega.co.nz links with better format support
 */
function isAllowedMegaLink(str) {
  try {
    const u = new URL(str);
    const isValidHost = ["mega.nz", "www.mega.nz", "mega.co.nz", "www.mega.co.nz"].includes(u.hostname);
    
    // Support both new and old MEGA link formats
    const isFileLink = u.pathname.startsWith("/file/") || 
                      (u.pathname === "/" && u.hash.startsWith("#!")) ||
                      u.pathname.startsWith("/#!");
    
    return isValidHost && isFileLink;
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
 * Enhanced download endpoint with better error handling
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
    console.log(Attempting to download from MEGA: ${megaLink});
    
    // Construct file from public link
    const file = File.fromURL(megaLink);
    
    // Load metadata first - this is where most errors occur
    await file.loadAttributes();
    
    const fileName = file.name || "download.bin";
    const fileSize = Number(file.size);
    
    // Validate file size
    if (!fileSize || fileSize === 0) {
      return res.status(400).send("File appears to be empty or invalid.");
    }
    
    console.log(Downloading file: ${fileName} (${fileSize} bytes));
    
    // Basic headers common to full and partial content
    res.setHeader("Content-Disposition", attachment; filename*=UTF-8''${encodeURIComponent(fileName)});
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    
    // Handle range requests (resume support)
    const range = parseRange(req.headers.range, fileSize);
    if (range) {
      const { start, end } = range;
      const chunkSize = end - start + 1;
      res.status(206); // Partial Content
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Range", bytes ${start}-${end}/${fileSize});
      res.setHeader("Content-Length", String(chunkSize));
      
      // Stream only the requested byte range
      file.download({ start, end }).pipe(res);
    } else {
      // Full file download
      res.status(200);
      res.setHeader("Content-Length", String(fileSize));
      res.setHeader("Content-Type", "application/octet-stream");
      
      // Stream the entire file
      file.download().pipe(res);
    }
    
  } catch (err) {
    console.error("MEGA download error:", err);
    
    // Provide more specific error messages based on MEGA API error codes
    if (err.message?.includes('ENOENT') || err.code === -9) {
      return res.status(404).send("File not found. The MEGA link may be invalid or the file was deleted.");
    }
    if (err.message?.includes('EACCESS') || err.code === -11) {
      return res.status(403).send("Access denied. The file may be private or the link is incorrect.");
    }
    if (err.message?.includes('EEXPIRED') || err.code === -8) {
      return res.status(410).send("The MEGA link has expired. Please get a fresh link.");
    }
    if (err.message?.includes('EOVERQUOTA') || err.code === -17) {
      return res.status(429).send("MEGA quota exceeded. Please try again later.");
    }
    if (err.message?.includes('EKEY') || err.message?.includes('decryption')) {
      return res.status(400).send("Invalid encryption key in the MEGA link.");
    }
    if (err.message?.includes('ETEMPUNAVAIL') || err.code === -18) {
      return res.status(503).send("MEGA service temporarily unavailable. Please try again later.");
    }
    
    // Generic error fallback
    return res.status(500).send(Failed to fetch from MEGA: ${err.message || 'Unknown error'});
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal server error');
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('Endpoint not found. Use /dl?link=<MEGA_PUBLIC_FILE_URL>');
});

app.listen(PORT, () => {
  console.log(Server listening on port ${PORT});
});
