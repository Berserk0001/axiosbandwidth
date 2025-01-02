import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import sharp from "sharp";

// Constants
const DEFAULT_QUALITY = 80;
const MIN_TRANSPARENT_COMPRESS_LENGTH = 50000;
const MIN_COMPRESS_LENGTH = 10000;
const TEMP_DIR = path.join(__dirname, "temp"); // Define temporary directory for image files

// Ensure the temporary directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

// Function to determine if compression is needed
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType.startsWith("image")) return false;
  if (originSize === 0 || req.headers.range) return false;

  if (
    !webp &&
    (originType.endsWith("png") || originType.endsWith("gif")) &&
    originSize < MIN_TRANSPARENT_COMPRESS_LENGTH
  ) {
    return false;
  }

  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;

  return true;
}

// Function to compress the image and save it to a temporary file
function compress(req, res, inputStream) {
  const format = req.params.webp ? "webp" : "jpeg";
  const tempFilePath = path.join(TEMP_DIR, `output.${format}`); // Temporary file path

  const sharpInstance = sharp({ unlimited: true, animated: false });

  inputStream.pipe(sharpInstance);

  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > 16383) {
        sharpInstance.resize({ height: 16383 });
      }

      if (req.params.grayscale) {
        sharpInstance.grayscale();
      }

      return sharpInstance
        .toFormat(format, { quality: req.params.quality })
        .toFile(tempFilePath); // Write the image to the temp file
    })
    .then(() => {
      // Once the image is saved to the temp file, we send it as the response
      fs.readFile(tempFilePath, (err, data) => {
        if (err) {
          console.error("Error reading temporary file:", err);
          res.statusCode = 500;
          return res.end("Failed to process the image.");
        }

        res.setHeader("Content-Type", `image/${format}`);
        res.setHeader("Content-Length", data.length);
        res.statusCode = 200;
        res.end(data);

        // Delete the temporary file after sending the response
        fs.unlink(tempFilePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("Error deleting temporary file:", unlinkErr);
          }
        });
      });
    })
    .catch((err) => {
      console.error("Compression error:", err.message);
      res.statusCode = 500;
      res.end("Failed to compress image.");
    });
}

// Function to handle the request
function handleRequest(req, res, origin) {
  if (shouldCompress(req)) {
    compress(req, res, origin.data);
  } else {
    res.setHeader("X-Proxy-Bypass", 1);

    ["accept-ranges", "content-type", "content-length", "content-range"].forEach((header) => {
      if (origin.headers[header]) {
        res.setHeader(header, origin.headers[header]);
      }
    });

    origin.data.pipe(res);
  }
}

// Function to fetch the image and process it
export function fetchImageAndHandle(req, res) {
  const url = req.query.url;  // Using req.params.url
  if (!url) {
    return res.end("bandwidth-hero-proxy");
  }

  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg,
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  // Select the correct client (http or https) based on the URL protocol
  const client = req.params.url.startsWith("https") ? https : http;

  client
    .get(req.params.url, (response) => {
      if (response.statusCode >= 400) {
        res.statusCode = response.statusCode;
        return res.end("Failed to fetch the image.");
      }

      req.params.originType = response.headers["content-type"];
      req.params.originSize = parseInt(response.headers["content-length"], 10) || 0;

      const origin = {
        headers: response.headers,
        data: response,
      };

      handleRequest(req, res, origin);
    })
    .on("error", (err) => {
      console.error("Error fetching image:", err.message);
      res.statusCode = 500;
      res.end("Failed to fetch the image.");
    });
}
