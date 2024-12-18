require("dotenv").config();
const fs = require("fs");
const EventEmitter = require("node:events");
const express = require("express");
const https = require("https");
const cors = require("cors");
const { v5 } = require("uuid");
const { parseFromString } = require("dom-parser");
const expressRateLimit = require("express-rate-limit");
const shotFactory = require("webshot-factory");

const { BASE_URL, IMAGE_ID_NAMESPACE, CHROME_PATH } = process.env;

/**
 * Random UUID namespace for producing IDs and nonces
 */
const imageIdNamespace = IMAGE_ID_NAMESPACE;

/**
 * The base url for proxied images to return to the client
 */
const baseUrl = BASE_URL;

/**
 * All requests are processed one by one to prevent the proxy from being blocked by remove hosts
 */
const processRequestQueueEveryMs = 1;

/**
 * The duration until the cached images are considered old and should be marked removed
 */
const imageExpireTimeMs = 60000;

/**
 * All images are cached for reuse until it's aged and removed automatically
 */
const checkForExpiredImagesMs = 60000;

/**
 * The maximum acceptable image size for frames - images are probed for size and rejected if it's larger than.
 */
const maxImageSize = 1048576 * 5;

/**
 * Valid image mimetypes
 */
const validImagesMimeTypes = [
  "image/png",
  "image/jpg",
  "image/gif",
  "image/jpeg",
  "image/webp",
];

/**
 * Request results stored, ready to be sent back to the client
 * Key: nonce
 * Value: { content: HTML, image: proxied image }
 */
const requestResults = {};

/**
 * Requests results processed are  emitted events to signal to the caller that it's ready for use
 */
const events = new EventEmitter();

/**
 * The requests in queue
 */
let requestsQueue = [];

/**
 * Has chromium been initialised - chromium is used for screenshotting web-pages - this is currently not used
 */
let chromiumInitialised = false;

const sslCredentials = {
  key: fs.readFileSync(__dirname + "/ssl/ssl.key", "utf-8"),
  cert: fs.readFileSync(__dirname + "/ssl/ssl.crt", "utf-8"),
  ca: fs.readFileSync(__dirname + "/ssl/ca.crt", "utf-8"),
};
const devMode = process.argv[2] === "dev";
const appServe = express();
appServe.use(
  cors(
    devMode === false
      ? {
          origin: ["*"],
          methods: ["GET", "POST", "OPTIONS"],
          allowedOrigin: "*",
        }
      : {}
  )
);
appServe.use(express.urlencoded({ limit: "10kb", extended: true }));
appServe.use(
  express.json({
    limit: "10kb",
  })
);
appServe.use(
  expressRateLimit({
    windowMs: 60000,
    max: 60000,
    keyGenerator: (req, res) => {
      return req.clientIp;
    },
  })
);
const appServeSecured =
  devMode === false ? https.createServer(sslCredentials, appServe) : appServe;
appServeSecured.listen(devMode === true ? 80 : 443, () => {
  console.log(
    "Proxy server listening on port " + (devMode === true ? 80 : 443)
  );
});

const removeStaleImages = () => {
  let working = false;
  setInterval(() => {
    if (working === true) {
      return;
    }
    working = true;
    const now = new Date().getTime();
    const filesListRaw = fs.readdirSync(__dirname + "/public/");
    const files = filesListRaw.filter(
      (f) => f !== "." && f !== ".." && f !== ".gitkeep"
    );
    for (const f of files) {
      const fileCreatedAt = f.split("-")[0];
      if (parseInt(fileCreatedAt) + imageExpireTimeMs < now) {
        fs.unlinkSync(__dirname + "/public/" + f);
      }
    }
    working = false;
  }, checkForExpiredImagesMs);
};

const processRequestsInQueue = () => {
  let working = false;
  setInterval(() => {
    if (working === true || requestsQueue.length <= 0) {
      return;
    }
    working = true;
    console.log("Processing work:", requestsQueue[0].arguments[0]);
    requestsQueue[0]
      .process(...requestsQueue[0].arguments)
      .then((r) => {
        const nonce = requestsQueue[0].nonce;
        requestResults[nonce] = r;
        requestsQueue.shift();
        events.emit(nonce, r);
        working = false;
      })
      .catch((e) => {
        const nonce = requestsQueue[0].nonce;
        requestResults[nonce] = Error("Unknown error has occured.");
        requestsQueue.shift();
        events.emit(nonce, requestResults[nonce]);
        working = false;
      });
  }, processRequestQueueEveryMs);
};

const isValidUrl = (url) => {
  return /^(http(s):\/\/.)[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:;%_\+.~#?&//=]*)$/g.test(
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

const isTxResponse = (response) => {
  try {
    const data = typeof response === "string" ? JSON.parse(response) : response;
    return (
      "chainId" in data === true &&
      "method" in data === true &&
      "params" in data &&
      "to" in data.params
    );
  } catch (e) {
    return false;
  }
};

const createId = (seed) => {
  return new Date().getTime() + "-" + v5(seed, imageIdNamespace);
};

const probeImageSize = (imageUrl) => {
  return new Promise((resolved, rejected) => {
    let headers;
    console.log("Probing image size for:", imageUrl);
    fetch(imageUrl.replaceAll("&amp;", "&"), {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })
      .then(async (r) => {
        if (r.status !== 200) {
          throw await r.text();
        }
        headers = r.headers;
        const contentType = headers.get("content-type");
        const contentLength = headers.get("content-length");
        if (validImagesMimeTypes.includes(contentType) === false) {
          console.log("Invalid image type.");
          throw await r.text();
        }
        if (contentLength > maxImageSize) {
          throw "Image too large";
        }
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
        rejected(Error("Could not probe image size."));
      });
  });
};

const saveImage = (
  frameUrl,
  imageArrayBuffer,
  imageMimeType,
  indexFrame = false
) => {
  const imageId = createId(
    (new Date().getTime() + Math.random() * 999999999).toString()
  );
  const fileExtension = imageMimeType.split("/")[1];
  fs.createWriteStream(
    __dirname + "/public/" + imageId + "." + fileExtension
  ).write(Buffer.from(imageArrayBuffer));
  if (indexFrame === true) {
    fs.createWriteStream(
      __dirname + "/index/" + frameUrl.replace(/[^0-9a-zA-Z\-]/g, "") + ".png"
    ).write(Buffer.from(imageArrayBuffer));
  }
  return baseUrl + "/public/" + imageId + "." + fileExtension;
};

const parseFrameContent = (frameContent) => {
  try {
    const doc = parseFromString(
      frameContent.replace(/<\![^<]+>/g, ""),
      "text/html"
    );
    const head = doc.getElementsByTagName("head")[0];
    return head.childNodes;
  } catch (e) {
    return Error("Invalid frame content.");
  }
};

const captureImage = (frameUrl) => {
  return new Promise((resolved, rejected) => {
    console.log("Capturing image:", frameUrl);
    console.log("Capture tool:", CHROME_PATH);
    (chromiumInitialised === false
      ? shotFactory.init({
          concurrency: 10,
          callbackName: "",
          warmerUrl: frameUrl,
          width: 1200,
          height: 630,
          timeout: 60000,
          chromeExecutablePath: CHROME_PATH,
        })
      : new Promise((resolved) => resolved(true))
    )
      .then((r) => {
        chromiumInitialised = true;
        return shotFactory.getShot(frameUrl);
      })
      .then((buffer) => {
        console.log("Image captured.");
        const imageId = createId(
          (new Date().getTime() + Math.random() * 999999999).toString()
        );
        fs.createWriteStream(
          __dirname + "/index/" + frameUrl.replace(/[^0-9a-zA-Z]/g, "") + ".png"
        ).write(buffer);
        fs.createWriteStream(__dirname + "/public/" + imageId + ".png").write(
          buffer
        );
        resolved(baseUrl + "/public/" + imageId + ".png");
      })
      .catch((e) => {
        rejected(Error("Cannot start page capture instance."));
      });
  });
};

const getFrameImage = (parsedFrameContent) => {
  try {
    let frameImageFound, imageFallback;
    for (let i = 0; i < parsedFrameContent.length; i++) {
      const headItem = parsedFrameContent[i];
      if (frameImageFound !== undefined) {
        break;
      }
      if (
        headItem !== null &&
        headItem.nodeName === "meta" &&
        (headItem.getAttribute("property") !== null ||
          headItem.getAttribute("name") !== null) &&
        (headItem.getAttribute("property") === "fc:frame:image" ||
          headItem.getAttribute("name") === "fc:frame:image" ||
          headItem.getAttribute("property") === "of:image" ||
          headItem.getAttribute("name") === "of:image" ||
          headItem.getAttribute("property") === "og:image" ||
          headItem.getAttribute("name") === "og:image")
      ) {
        const imageUrl = headItem.getAttribute("content");
        if (isValidUrl(imageUrl) === false) {
          throw Error("Invalid image URL");
        }
        if (
          headItem.getAttribute("property") === "fc:frame:image" ||
          headItem.getAttribute("name") === "fc:frame:image" ||
          headItem.getAttribute("property") === "of:image" ||
          headItem.getAttribute("name") === "of:image"
        ) {
          frameImageFound = imageUrl;
        } else if (
          headItem.getAttribute("property") === "og:image" ||
          headItem.getAttribute("name") === "og:image"
        ) {
          imageFallback = imageUrl;
        }
      }
    }
    const findImg = /.+(\.jpg|\.png|\.jpeg|\.gif)/g;
    if (frameImageFound === undefined && imageFallback !== undefined) {
      const matched = imageFallback.match(findImg);
      return matched[0];
    } else if (frameImageFound !== undefined) {
      const matched = frameImageFound.match(findImg);
      return matched[0];
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
          const error = await r.text();
          throw error;
        }
        return r.text();
      })
      .then((r) => {
        if (typeof r === "object" || testJSON(r) === true) {
          if (isTxResponse(r) === false) {
            throw "Not a transaction response.";
          }
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
          return null;
        }
        console.log("Frame image found:", frameImage);
        return probeImageSize(frameImage);
      })
      .then((r) => {
        if (r === null || r instanceof Error) {
          return null;
        }
        const { buffer, mimeType } = r;
        return saveImage(targetUrl, buffer, mimeType, method === "GET");
      })
      .then((r) => {
        console.log("Target resolved:", targetUrl, r);
        resolved({
          content: frameContentRaw,
          image: r,
        });
      })
      .catch((e) => {
        rejected(Error("Could not process frame: " + e));
      });
  });
};

const addWork = (nonce, targetUrl, method, payload = null) => {
  const work = {
    nonce,
    process: processFrame,
    arguments: [targetUrl, method, payload],
  };
  requestsQueue.push(work);
};

const findResults = (nonce) => {
  return new Promise((resolved, rejected) => {
    events.on(nonce, (e) => {
      resolved(e);
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

appServe.get("/index/:resource", (req, res) => {
  try {
    const resource = req.params.resource;
    if (
      /[^0-9a-zA-Z\.\-]*/g.test(resource) === false ||
      resource.indexOf("..") > -1
    ) {
      res.status(500).end("Invalid resource.");
      return;
    }
    if (fs.existsSync(__dirname + "/index/" + resource) === false) {
      res.status(500).end("Resource does not exist.");
      return;
    }
    res.sendFile(__dirname + "/index/" + resource);
  } catch (e) {
    res.status(503).end("Unknown error");
  }
});

appServe.get("/public/:resource", (req, res) => {
  try {
    const resource = req.params.resource;
    if (
      /[^0-9a-zA-Z\.\-]*/g.test(resource) === false ||
      resource.indexOf("..") > -1
    ) {
      res.status(500).end("Invalid resource.");
      return;
    }
    if (fs.existsSync(__dirname + "/public/" + resource) === false) {
      res.status(500).end("Resource does not exist.");
      return;
    }
    res.sendFile(__dirname + "/public/" + resource);
  } catch (e) {
    res.status(503).end("Unknown error");
  }
});

appServe.get("/:frame", (req, res) => {
  try {
    const frameUrl = req.params.frame;
    if (frameUrl === "favicon.ico") {
      res.status(503).end();
      return;
    }
    console.log("Frame proxy request received (GET):", frameUrl);
    const nonce = createId((Math.random() * 9999999).toString());
    findResults(nonce)
      .then((r) => {
        if (r instanceof Error) {
          res.status(503).end(r);
          return;
        }
        res.status(200).send(r);
      })
      .catch((e) => {
        res.status(503).end("Unknown error has occured.");
      });
    addWork(nonce, frameUrl, "GET");
  } catch (e) {
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
    processFrame(frameUrl, "POST", framePayload)
      .then((r) => {
        if (r instanceof Error) {
          res.status(503).end(r);
          return;
        }
        res.status(200).send(r);
      })
      .catch((e) => {
        res.status(503).end("Unknown error has occured.");
      });
  } catch (e) {
    res.status(503).end("Unknown error");
  }
});

removeStaleImages();
processRequestsInQueue();
