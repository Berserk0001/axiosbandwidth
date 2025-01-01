"use strict";

import axios from "axios";
import sharp from "sharp";

const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;  // Minimum size for compression
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;  // Threshold for PNG/GIF compression

// Function to handle compression with Sharp
function compressImageStream(inputStream, format, quality) {
  sharp.cache(false);
  sharp.simd(true);

  const transformer = sharp({ unlimited: true });
  return inputStream
    .pipe(transformer)
    .toFormat(format, { quality })
    .on("error", (err) => {
      console.error("Sharp processing error:", err.message);
      throw err;
    });
}

// Function to fetch image via Axios
async function fetchImage(url, options = {}) {
  try {
    const response = await axios.get(url, {
      responseType: "stream",
      ...options,
    });

    if (!response.headers["content-type"].startsWith("image")) {
      throw new Error("URL does not point to an image.");
    }

    return response;
  } catch (err) {
    console.error("Error fetching image:", err.message);
    throw err;
  }
}

// Function to determine if the image should be compressed
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType.startsWith("image")) return false;
  if (originSize === 0 || req.headers.range) return false;

  // Only compress PNG/GIF if large enough or webp is requested
  if (
    !webp &&
    (originType.endsWith("png") || originType.endsWith("gif")) &&
    originSize < MIN_TRANSPARENT_COMPRESS_LENGTH
  ) {
    return false;
  }

  // Compress webp images only if above the minimum size threshold
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;

  return true;
}

// Proxy and Compression Endpoint
export async function imageProxy(req, res) {
  const { url, format = "webp", quality = DEFAULT_QUALITY } = req.query;

  if (!url) {
    return res.status(400).send("Missing URL parameter.");
  }

  try {
    const imageResponse = await fetchImage(decodeURIComponent(url));
    const { headers } = imageResponse;

    // Prepare the request parameters
    req.params = {
      originType: headers["content-type"] || "",
      originSize: parseInt(headers["content-length"] || "0", 10),
      webp: format === "webp",
    };

    // If image should be compressed, apply compression
    if (shouldCompress(req)) {
      res.setHeader("Content-Type", `image/${format}`);
      res.setHeader("Access-Control-Allow-Origin", "*");

      const compressedStream = compressImageStream(
        imageResponse.data,
        format,
        parseInt(quality, 10)
      );

      compressedStream.pipe(res);
    } else {
      // Otherwise, stream the original image
      res.setHeader("Content-Type", req.params.originType);
      res.setHeader("Access-Control-Allow-Origin", "*");

      imageResponse.data.pipe(res);
    }
  } catch (err) {
    console.error("Error processing image:", err.message);
    res.status(500).send("Internal Server Error.");
  }
}
