import axios from "axios";
import sharp from "sharp";

// Constants
const DEFAULT_QUALITY = 80;
const MIN_TRANSPARENT_COMPRESS_LENGTH = 50000;
const MIN_COMPRESS_LENGTH = 10000;

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

// Function to compress the image
function compress(req, res, inputStream) {
  const format = req.params.webp ? "webp" : "jpeg";
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
        .toBuffer();
    })
    .then((buffer) => {
      res.setHeader("Content-Type", `image/${format}`);
      res.setHeader("Content-Length", buffer.length);
      res.statusCode = 200;
      res.end(buffer);
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
  const url = req.query.url;
  if (!url) {
    return res.end("bandwidth-hero-proxy");
  }

  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg,
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  axios({
    method: "get",
    url: req.params.url,
    responseType: "stream",
  })
    .then((response) => {
      req.params.originType = response.headers["content-type"];
      req.params.originSize = parseInt(response.headers["content-length"], 10) || 0;

      const origin = {
        headers: response.headers,
        data: response.data,
      };

      handleRequest(req, res, origin);
    })
    .catch((error) => {
      console.error("Error fetching image:", error.message);
      res.statusCode = 500;
      res.end("Failed to fetch the image.");
    });
}
