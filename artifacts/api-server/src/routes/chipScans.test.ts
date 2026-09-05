import type { Server } from "node:http";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  getUser: vi.fn(),
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: { models: { generateContent: mocks.generateContent } },
}));

vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: mocks.getUser } },
  clerkMiddleware:
    () =>
    (
      req: { headers: Record<string, string | undefined>; testAuth?: unknown },
      _res: unknown,
      next: () => void,
    ) => {
      const userId = req.headers["x-test-user"];
      req.testAuth = userId ? { userId, sessionClaims: { userId } } : {};
      next();
    },
  getAuth: (req: { testAuth?: unknown }) => req.testAuth ?? {},
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: mocks.db };
});

import app from "../app";
import {
  ChipAnalysisTimeoutError,
  generateChipAnalysis,
} from "./chipScans";

const adminEmail = "admin@example.com";
let pngBase64: string;
let body: { imageBase64: string; mimeType: "image/png" };
let fixtures: Array<{ imageBase64: string; mimeType: "image/jpeg" | "image/png" | "image/webp" }>;
let server: Server;
let baseUrl: string;

async function request(init: RequestInit = {}, userId?: string) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (userId) headers.set("x-test-user", userId);
  return fetch(`${baseUrl}/api/chip-scans/analyze`, {
    ...init,
    headers,
    body: init.body ?? JSON.stringify(body),
  });
}

beforeAll(async () => {
  const source = {
    create: {
      width: 4,
      height: 3,
      channels: 3 as const,
      background: { r: 12, g: 34, b: 56 },
    },
  };
  const [jpeg, png, webp] = await Promise.all([
    sharp(source).jpeg().toBuffer(),
    sharp(source).png().toBuffer(),
    sharp(source).webp().toBuffer(),
  ]);
  fixtures = [
    { imageBase64: jpeg.toString("base64"), mimeType: "image/jpeg" },
    { imageBase64: png.toString("base64"), mimeType: "image/png" },
    { imageBase64: webp.toString("base64"), mimeType: "image/webp" },
  ];
  pngBase64 = fixtures[1].imageBase64;
  body = { imageBase64: pngBase64, mimeType: "image/png" };

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  process.env.ADMIN_EMAILS = adminEmail;
  vi.clearAllMocks();
  mocks.getUser.mockImplementation(async (userId: string) => ({
    emailAddresses: [{
      emailAddress: userId === "admin" ? adminEmail : "viewer@example.com",
    }],
  }));
});

describe("POST /chip-scans/analyze", () => {
  it("rejects untrusted browser origins before authentication or provider work", async () => {
    const response = await request(
      { method: "POST", headers: { origin: "https://untrusted.example" } },
      "admin",
    );

    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("does not trust spoofed forwarded hosts or insecure non-loopback origins", async () => {
    for (const headers of [
      {
        origin: "https://untrusted.example",
        "x-forwarded-host": "untrusted.example",
      },
      {
        origin: "http://scoreboard.example",
        host: "scoreboard.example",
      },
    ]) {
      const response = await request({ method: "POST", headers }, "admin");
      expect(response.status).toBe(403);
    }

    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("allows a same-origin loopback request during development", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        countable: true,
        stacks: [{ denomination: "white", count: 1, confidence: 1, uncertainty: "" }],
        guidance: "",
      }),
    });

    const response = await request(
      { method: "POST", headers: { origin: baseUrl } },
      "admin",
    );

    expect(response.status).toBe(200);
  });

  it("requires a signed-in administrator", async () => {
    expect((await request({ method: "POST" })).status).toBe(401);
    expect((await request({ method: "POST" }, "viewer")).status).toBe(403);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("rejects malformed Base64 and MIME signature mismatches", async () => {
    for (const invalidBody of [
      { ...body, imageBase64: "not base64!!!!" },
      { ...body, mimeType: "image/jpeg" },
    ]) {
    const response = await request(
      { method: "POST", body: JSON.stringify(invalidBody) },
      "admin",
    );
    expect(response.status).toBe(400);
    }
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("rejects corrupt and truncated images that have a valid PNG prefix", async () => {
    const corrupt = Buffer.from(pngBase64, "base64").subarray(0, 12).toString("base64");
    const response = await request(
      { method: "POST", body: JSON.stringify({ ...body, imageBase64: corrupt }) },
      "admin",
    );
    expect(response.status).toBe(400);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("rejects oversized decoded pixel dimensions before provider work", async () => {
    const oversized = await sharp({
      create: {
        width: 5000,
        height: 4001,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    }).png({ compressionLevel: 9 }).toBuffer();
    const response = await request(
      {
        method: "POST",
        body: JSON.stringify({
          imageBase64: oversized.toString("base64"),
          mimeType: "image/png",
        }),
      },
      "admin",
    );
    expect(response.status).toBe(400);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it.each(["image/jpeg", "image/png", "image/webp"] as const)(
    "normalizes %s input to sanitized JPEG before provider analysis",
    async (mimeType) => {
      const fixture = fixtures.find((item) => item.mimeType === mimeType);
      if (!fixture) throw new Error("Missing image fixture");
      mocks.generateContent.mockResolvedValue({
        text: JSON.stringify({
          countable: true,
          stacks: [{ denomination: "white", count: 1, confidence: 1, uncertainty: "" }],
          guidance: "",
        }),
      });

      const response = await request(
        { method: "POST", body: JSON.stringify(fixture) },
        "admin",
      );

      expect(response.status).toBe(200);
      const providerInput = mocks.generateContent.mock.calls[0][0]
        .contents[0].parts[1].inlineData;
      expect(providerInput.mimeType).toBe("image/jpeg");
      expect(providerInput.data).not.toBe(fixture.imageBase64);
      expect((await sharp(Buffer.from(providerInput.data, "base64")).metadata()).format)
        .toBe("jpeg");
    },
  );

  it("maps malformed and duplicate provider output to a safe 502", async () => {
    mocks.generateContent.mockResolvedValueOnce({ text: "{not json" });
    expect((await request({ method: "POST" }, "admin")).status).toBe(502);

    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        stacks: [
          { denomination: "white", count: 2, confidence: 0.9, uncertainty: "" },
          { denomination: "white", count: 3, confidence: 0.8, uncertainty: "" },
        ],
        countable: true,
        guidance: "",
      }),
    });
    expect((await request({ method: "POST" }, "admin")).status).toBe(502);
  });

  it("returns 422 with retake guidance for an uncountable image", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        countable: false,
        stacks: [],
        guidance: "Separate the stacks and show every side layer.",
      }),
    });
    const response = await request({ method: "POST" }, "admin");
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "Separate the stacks and show every side layer.",
    });
  });

  it("returns 422 when a countable result has no stacks", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        countable: true,
        stacks: [],
        guidance: "Retake the image with all stacks visible.",
      }),
    });

    const response = await request({ method: "POST" }, "admin");

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "Retake the image with all stacks visible.",
    });
  });

  it("returns a validated structured result without persisting the image", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        stacks: [
          { denomination: "white", count: 12, confidence: 0.8, uncertainty: "" },
          {
            denomination: "black",
            count: 4,
            confidence: 1,
            uncertainty: "Bottom edge is slightly shadowed.",
          },
        ],
        countable: true,
        guidance: "",
      }),
    });

    const response = await request({ method: "POST" }, "admin");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      stacks: [
        { denomination: "white", count: 12, confidence: 0.8, uncertainty: null },
        {
          denomination: "black",
          count: 4,
          confidence: 1,
          uncertainty: "Bottom edge is slightly shadowed.",
        },
      ],
      overallConfidence: 0.9,
      guidance: null,
    });
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
    expect(mocks.db.delete).not.toHaveBeenCalled();
  });

  it("returns a distinct safe 502 when the provider times out", async () => {
    // This controllable rejection exercises the safe HTTP timeout response.
    mocks.generateContent.mockRejectedValue(new ChipAnalysisTimeoutError());

    const response = await request({ method: "POST" }, "admin");

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Image analysis service timed out",
    });
  });

  it("enforces the provider timeout without a 25-second test delay", async () => {
    mocks.generateContent.mockImplementation(
      () => new Promise(() => undefined),
    );

    await expect(
      generateChipAnalysis("image/png", pngBase64, 0),
    ).rejects.toBeInstanceOf(ChipAnalysisTimeoutError);
  });
});