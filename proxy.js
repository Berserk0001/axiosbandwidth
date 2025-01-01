"use strict";
import axios from "axios";
import sharp from "sharp";
import UserAgent from "user-agents";

const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;

function copyHeaders(source, target) {
  for (const [key, value] of Object.entries(source.headers)) {
    try {
      target.setHeader(key, value);
    } catch (e) {
      console.error(`Error copying header ${key}:`, e.message);
    }
  }
}

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

function redirect(req, res) {
  if (res.headersSent) return;

  res.setHeader("content-length", 0);
  res.removeHeader("cache-control");
  res.removeHeader("expires");
  res.removeHeader("date");
  res.removeHeader("etag");
  res.setHeader("location", encodeURI(req.params.url));
  res.statusCode = 302;
  res.end();
}

function compress(req, res, input) {
  const format = "webp";
  sharp.cache(false);
  sharp.simd(true);
  sharp.concurrency(1);
  const transformer = sharp({ unlimited: true });

  input.pipe(transformer);

  transformer
    .metadata()
    .then((metadata) => {
      if (metadata.height > 16383) {
        transformer.resize({ height: 16383 });
      }

      transformer
        .grayscale(req.params.grayscale)
        .toFormat(format, {
          quality: req.params.quality,
          lossless: false,
          effort: 0,
        });

      res.setHeader("content-type", `image/${format}`);
      res.setHeader("x-original-size", req.params.originSize);

      transformer
        .on("data", (chunk) => res.write(chunk))
        .on("end", () => res.end())
        .on("info", (info) => {
          res.setHeader("content-length", info.size);
          res.setHeader("x-bytes-saved", req.params.originSize - info.size);
        })
        .on("error", (err) => {
          console.error("Compression error:", err.message);
          redirect(req, res);
        });
    })
    .catch((err) => {
      console.error("Metadata error:", err.message);
      redirect(req, res);
    });
}

async function hhproxy(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.end("bandwidth-hero-proxy");
  }

  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg,
    grayscale: req.query.bw !== "0",
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  const userAgent = new UserAgent().toString();
  const options = {
    responseType: "stream",
    headers: {
      "User-Agent": userAgent,
      ...req.headers,
    },
    maxRedirects: 4,
    timeout: 5000,
  };

  try {
    const response = await axios.get(req.params.url, options);

    req.params.originType = response.headers["content-type"] || "";
    req.params.originSize = parseInt(response.headers["content-length"] || "0", 10);

    if (shouldCompress(req)) {
      compress(req, res, response.data);
    } else {
      copyHeaders(response, res);
      res.setHeader("X-Proxy-Bypass", 1);
      response.data.pipe(res);
    }
  } catch (err) {
    console.error("Request error:", err.message);
    redirect(req, res);
  }
}

export default hhproxy;
