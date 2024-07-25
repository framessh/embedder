const fs = require("fs");
const express = require("express");
const https = require("https");
const cors = require("cors");
const { v5 } = require("uuid");
const { parseFromString } = require("dom-parser");
const expressRateLimit = require("express-rate-limit");

const imageIdNamespace = "b55a86a5-2089-4201-aeaa-8c7535695d7f";
const baseUrl = "https://localhost";
const publicPath = "public";
const imageExpireTimeMs = 60000;
const checkForExpiredImagesMs = 60000;
const maxImageSize = 1048576 * 5;
const validImagesMimeTypes = [
  "image/png",
  "image/jpg",
  "image/gif",
  "image/jpeg",
];

const sslCredentials = {
  key: fs.readFileSync(__dirname + "/ssl/ssl.key", "utf-8"),
  cert: fs.readFileSync(__dirname + "/ssl/ssl.crt", "utf-8"),
  ca: fs.readFileSync(__dirname + "/ssl/ca.crt", "utf-8"),
};

const appServe = express();
appServe.use(cors());
appServe.use("/" + publicPath, express.static("public"));
appServe.use(express.urlencoded({ limit: "10kb", extended: true }));
appServe.use(
  express.json({
    limit: "10kb",
  })
);
appServe.use(
  expressRateLimit({
    windowMs: 60000,
    max: 1000,
    keyGenerator: (req, res) => {
      return req.clientIp;
    },
  })
);
const appServeSecured = https.createServer(sslCredentials, appServe);
appServeSecured.listen(443, () => {
  console.log("Proxy server listening on port " + 443);
});

const removeStaleImages = () => {
  let working = false;
  setInterval(() => {
    if (working === true) {
      return;
    }
    working = true;
    console.log("Checking for expired images...");
    const now = new Date().getTime();
    const filesListRaw = fs.readdirSync("public/");
    const files = filesListRaw.filter(
      (f) => f !== "." && f !== ".." && f !== ".gitkeep"
    );
    for (const f of files) {
      const fileCreatedAt = f.split("-")[0];
      if (parseInt(fileCreatedAt) + imageExpireTimeMs < now) {
        fs.unlinkSync("public/" + f);
      }
    }
    console.log("Checking for expired images done. Stale images removed.");
    working = false;
  }, checkForExpiredImagesMs);
};

const isValidUrl = (url) => {
  return /^(http(s):\/\/.)[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)$/g.test(
    url
  );
};

const isValidPayload = (payload) => {
  return (
    "untrustedData" in payload === true &&
    "fid" in payload.untrustedData === true &&
    "url" in payload.untrustedData === true &&
    "buttonIndex" in payload.untrustedData === true
  );
};

const createImageId = (seed) => {
  return new Date().getTime() + "-" + v5(seed, imageIdNamespace);
};

const probeImageSize = (imageUrl) => {
  return new Promise((resolved, rejected) => {
    console.log("Probing image size for:", imageUrl);
    fetch(imageUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => {
        if (r.status !== 200) {
          throw r.text();
        }
        const headers = r.headers;
        const contentType = headers.get("content-type");
        const contentLength = headers.get("content-length");
        if (validImagesMimeTypes.includes(contentType) === false) {
          console.log("Invalid image type.");
          throw r.text();
        }
        resolved(contentLength);
        return r.text();
      })
      .catch((e) => {
        console.log(e);
        rejected(Error("Could not probe image size."));
      });
  });
};

const getImage = (imageUrl) => {
  return new Promise((resolved, rejected) => {
    let headers;
    fetch(imageUrl, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => {
        if (r.status !== 200) {
          throw r.text();
        }
        headers = r.headers;
        return r.arrayBuffer();
      })
      .then((r) => {
        const contentType = headers.get("content-type");
        resolved({
          buffer: r,
          mimeType: contentType,
        });
      })
      .catch((e) => {
        console.log(e);
        rejected(Error("Could not get image."));
      });
  });
};

const saveImage = (imageArrayBuffer, imageMimeType) => {
  const imageId = createImageId(
    (new Date().getTime() + Math.random() * 999999999).toString()
  );
  const buffer = Buffer.from(imageArrayBuffer);
  const fileExtension = imageMimeType.split("/")[1];
  fs.createWriteStream("public/" + imageId + "." + fileExtension).write(buffer);
  return baseUrl + "/public/" + imageId + "." + fileExtension;
};

const parseFrameContent = (frameContent) => {
  try {
    const doc = parseFromString(frameContent, "text/html");
    const head = doc.getElementsByTagName("HEAD")[0];
    return head.childNodes;
  } catch (e) {
    return Error("Invalid frame content.");
  }
};

const getFrameImage = (parsedFrameContent) => {
  try {
    for (let i = 0; i < parsedFrameContent.length; i++) {
      const headItem = parsedFrameContent[i];
      if (
        headItem !== null &&
        headItem.nodeName === "meta" &&
        headItem.getAttribute("property") !== null &&
        (headItem.getAttribute("property") === "fc:frame:image" ||
          headItem.getAttribute("property") === "of:image")
      ) {
        const imageUrl = headItem.getAttribute("content");
        if (isValidUrl(imageUrl) === false) {
          throw null;
        }
        return imageUrl;
      }
    }
    return Error("No image found in content.");
  } catch (e) {
    return Error("Could no parse frame content for iamge.");
  }
};

const processFrame = (targetUrl, method, payload = null) => {
  return new Promise((resolved, rejected) => {
    if (targetUrl === undefined || isValidUrl(targetUrl) === false) {
      rejected(Error("Invalid URL"));
    }
    if (
      payload !== null &&
      (payload === undefined || isValidPayload(payload) === false)
    ) {
      rejected(Error("Invalid payload."));
    }
    let frameContentRaw, frameImage;
    fetch(targetUrl, {
      method,
      headers: {
        "content-type": "application/json",
        signal: AbortSignal.timeout(5000),
      },
      ...(method === "POST" && payload !== null
        ? { body: JSON.stringify(payload) }
        : {}),
    })
      .then(async (r) => {
        if (r.status !== 200) {
          throw r.text();
        }
        const headers = r.headers;
        const contentType = headers.get("content-type");
        if (
          contentType !== "text/html" &&
          contentType !== "text/plain" &&
          contentType === "application/json"
        ) {
          return r.json();
        }
        return r.text();
      })
      .then((r) => {
        if (typeof r === "object" || testJSON(r) === true) {
          resolved({
            content: typeof r === "string" ? JSON.parse(r) : r,
          });
          return null;
        }
        const parsedContent = parseFrameContent(r);
        if (parsedContent instanceof Error) {
          throw "Invalid content";
        }
        frameContentRaw = r;
        frameImage = getFrameImage(parsedContent);
        if (frameImage instanceof Error) {
          throw "Invalid content";
        }
        return probeImageSize(frameImage);
      })
      .then((imageSize) => {
        if (imageSize === null) {
          return null;
        }
        if (imageSize > maxImageSize) {
          throw "Image too large.";
        }
        return getImage(frameImage);
      })
      .then((r) => {
        if (r === null) {
          return null;
        }
        const { buffer, mimeType } = r;
        return saveImage(buffer, mimeType);
      })
      .then((r) => {
        resolved({
          content: frameContentRaw,
          image: r,
        });
      })
      .catch((e) => {
        console.log("An error has occured: ", e);
        rejected(Error("Could not process frame: " + e));
      });
  });
};

const testJSON = (json) => {
  const str = json.toString();
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
};

appServe.get("/:frame", (req, res) => {
  try {
    const frameUrl = req.params.frame;
    if (frameUrl === "favicon.ico") {
      res.status(503).end();
      return;
    }
    console.log("Frame proxy request received (GET):", frameUrl);
    processFrame(frameUrl, "GET").then((result) => {
      if (result instanceof Error) {
        res.status(503).end(result);
        return;
      }
      res.status(200).send(result);
    });
  } catch (e) {
    console.log(e);
    res.status(503).end("Unknown error");
  }
});

appServe.post("/", (req, res) => {
  try {
    const frameUrl = req.body.target;
    const framePayload = req.body.payload;
    if (frameUrl === "favicon.ico") {
      res.status(503).end();
      return;
    }
    console.log("Frame proxy request received (POST):", frameUrl);
    processFrame(frameUrl, "POST", framePayload).then((result) => {
      if (result instanceof Error) {
        res.status(503).end(result);
        return;
      }
      res.status(200).send(result);
    });
  } catch (e) {
    res.status(503).end("Unknown error");
  }
});

removeStaleImages();