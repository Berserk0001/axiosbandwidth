import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
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


// Function to compress the image and stream it directly to the response
function compress(req, res, inputStream) {
  const format = req.params.webp ? "webp" : "jpeg";

  const sharpInstance = sharp({ unlimited: true, animated: false });

  // Pipe the input stream to sharp for processing
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

      // Set up the response headers for streaming
      res.setHeader("Content-Type", `image/${format}`);
      res.setHeader("X-Original-Size", req.params.originSize);
      
      // Pipe the processed image directly to the response
      sharpInstance
        .toFormat(format, { quality: req.params.quality })
        .pipe(res)  // Directly pipe the result to the response stream
        .on('finish', () => {
          //console.log('Image compression and streaming complete.');
          res.end();
        })
        .on('error', (err) => {
          console.error('Compression error:', err.message);
          res.statusCode = 500;
          res.end('Failed to compress the image.');
        });
    })
    .catch((err) => {
      console.error('Metadata error:', err.message);
      res.statusCode = 500;
      res.end('Failed to fetch image metadata.');
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
