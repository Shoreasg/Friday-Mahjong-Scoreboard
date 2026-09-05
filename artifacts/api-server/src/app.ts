import express, { type Express, type Request } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
const configuredCorsOrigins = new Set(
  process.env.CORS_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function isTrustedBrowserOrigin(req: Request, origin: string): boolean {
  try {
    const originUrl = new URL(origin);
    const requestHost = req.get("host");
    const isLoopback =
      originUrl.hostname === "localhost" ||
      originUrl.hostname === "127.0.0.1" ||
      originUrl.hostname === "::1";
    const trustedScheme = originUrl.protocol === "https:" ||
      (originUrl.protocol === "http:" && isLoopback);

    return (
      (trustedScheme && originUrl.host === requestHost) ||
      configuredCorsOrigins.has(originUrl.origin)
    );
  } catch {
    return false;
  }
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (!origin || isTrustedBrowserOrigin(req, origin)) {
    next();
    return;
  }

  req.log.warn({ category: "untrusted_origin" }, "Rejected cross-origin request");
  res.status(403).json({ error: "Cross-origin request not allowed" });
});
app.use(cors({ credentials: true, origin: true }));
// A 4 MiB image is ~5.34 MiB once Base64 encoded.
app.use(express.json({ limit: "7mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
