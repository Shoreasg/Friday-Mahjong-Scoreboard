import {
  AnalyzeChipStacksBody,
  AnalyzeChipStacksResponse,
  z,
} from "@workspace/api-zod";
import { ai } from "@workspace/integrations-gemini-ai";
import { Router, type IRouter } from "express";
import sharp from "sharp";
import { requireAdmin } from "./requireAdmin";

const router: IRouter = Router();
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_PIXELS = 20_000_000;
const NORMALIZED_MIME_TYPE = "image/jpeg";

/*
 * This is deliberately separate from the generated response schema. Gemini
 * must not supply an overall total or an overall confidence: the latter is
 * derived from validated individual stack confidences below.
 */
const ProviderStackSchema = z.object({
  denomination: z.enum(["white", "orange", "light_blue", "blue", "black"]),
  count: z.int().min(1).max(500),
  confidence: z.number().min(0).max(1),
  uncertainty: z.string().max(240),
}).strict();

const ProviderResultSchema = z.object({
  countable: z.boolean(),
  stacks: z.array(ProviderStackSchema).max(5),
  guidance: z.string().max(300),
}).strict();

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["countable", "stacks", "guidance"],
  properties: {
    countable: { type: "boolean" },
    stacks: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["denomination", "count", "confidence", "uncertainty"],
        properties: {
          denomination: {
            type: "string",
            enum: ["white", "orange", "light_blue", "blue", "black"],
          },
          count: { type: "integer", minimum: 1, maximum: 500 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          uncertainty: { type: "string", maxLength: 240 },
        },
      },
    },
    guidance: { type: "string", maxLength: 300 },
  },
};
const PROVIDER_TIMEOUT_MS = 25_000;

export class ChipAnalysisTimeoutError extends Error {
  constructor() {
    super("Chip scan analysis timed out");
    this.name = "ChipAnalysisTimeoutError";
  }
}

function decodeBase64(value: string): Buffer | null {
  // Buffer.from is deliberately permissive, so compare its canonical encoding
  // after first requiring padded standard Base64.
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    return null;
  }

  const image = Buffer.from(value, "base64");
  return image.toString("base64") === value ? image : null;
}

function signatureMatches(image: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return (
      image.length >= 3 &&
      image[0] === 0xff &&
      image[1] === 0xd8 &&
      image[2] === 0xff
    );
  }
  if (mimeType === "image/png") {
    return (
      image.length >= 8 &&
      image.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    );
  }
  return (
    image.length >= 12 &&
    image.subarray(0, 4).toString("ascii") === "RIFF" &&
    image.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

class InvalidImageError extends Error {}

async function normalizeImage(
  image: Buffer,
  declaredMimeType: string,
): Promise<Buffer> {
  try {
    // Metadata checks guard dimensions/pages; toBuffer below then fully decodes,
    // auto-rotates, removes metadata, and creates the sole provider input.
    const metadata = await sharp(image, {
      animated: true,
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
    const expectedFormat = declaredMimeType.slice("image/".length);
    if (
      metadata.format !== expectedFormat ||
      !Number.isInteger(metadata.width) ||
      !Number.isInteger(metadata.height) ||
      metadata.width <= 0 ||
      metadata.height <= 0 ||
      (metadata.pages !== undefined && metadata.pages > 1)
    ) {
      throw new InvalidImageError();
    }

    const normalized = await sharp(image, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    if (normalized.length === 0 || normalized.length > MAX_IMAGE_BYTES) {
      throw new InvalidImageError();
    }
    return normalized;
  } catch {
    throw new InvalidImageError();
  }
}

function overallConfidence(
  stacks: Array<{ confidence: number }>,
): number {
  const average =
    stacks.reduce((total, stack) => total + stack.confidence, 0) /
    stacks.length;
  return Math.max(0, Math.min(1, average));
}

const prompt = `Analyze this image of Mahjong chip stacks. Count only separate,
fully visible, countable stacks for these exact denominations: white ($1),
orange ($5), light_blue ($10), blue ($50), and black ($100). Inspect both the
top label/color and visible side layers. Lighting can shift chip colors, so use
the large printed value to distinguish light-blue $10 chips from deeper-blue
$50 chips. Do not infer a count from a grand total, and never output a grand
total.

Return exactly one JSON object with boolean "countable", "stacks", and
"guidance". If any stack is touching another stack, partly hidden, cropped,
loose/unstacked, or cannot be counted reliably, set countable to false, use an
empty stacks array, and give concise retake guidance. Otherwise set countable
to true and provide each stack with denomination, integer count, confidence
from 0 to 1, and required uncertainty string (empty means none). Include each
denomination at most once. Do not include markdown or any other fields.`;

export async function generateChipAnalysis(
  mimeType: string,
  data: string,
  timeoutMs = PROVIDER_TIMEOUT_MS,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data } },
          ],
        }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema,
        },
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new ChipAnalysisTimeoutError()),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

router.post("/chip-scans/analyze", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const body = AnalyzeChipStacksBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid image request" });
    return;
  }

  const image = decodeBase64(body.data.imageBase64);
  if (!image) {
    res.status(400).json({ error: "imageBase64 must be canonical Base64" });
    return;
  }
  if (image.length > MAX_IMAGE_BYTES) {
    res.status(413).json({ error: "Image must not exceed 4 MB" });
    return;
  }
  if (!signatureMatches(image, body.data.mimeType)) {
    res.status(400).json({ error: "Image MIME type does not match its signature" });
    return;
  }

  let normalizedImage: Buffer;
  try {
    normalizedImage = await normalizeImage(image, body.data.mimeType);
  } catch {
    res.status(400).json({ error: "Invalid or unsupported image" });
    return;
  }

  try {
    const providerResponse = await generateChipAnalysis(
      NORMALIZED_MIME_TYPE,
      normalizedImage.toString("base64"),
    );
    const rawText = providerResponse.text;
    if (!rawText) throw new Error("Provider returned no text");

    let providerData: unknown;
    try {
      providerData = JSON.parse(rawText);
    } catch {
      throw new Error("Provider returned invalid JSON");
    }

    const parsed = ProviderResultSchema.safeParse(providerData);
    if (!parsed.success) throw new Error("Provider result did not match schema");
    if (!parsed.data.countable || parsed.data.stacks.length === 0) {
      res.status(422).json({
        error: parsed.data.guidance || "Retake the photo with separated stacks.",
      });
      return;
    }

    const denominations = new Set<string>();
    for (const stack of parsed.data.stacks) {
      if (denominations.has(stack.denomination)) {
        throw new Error("Provider returned duplicate denomination");
      }
      denominations.add(stack.denomination);
    }

    const result = AnalyzeChipStacksResponse.parse({
      stacks: parsed.data.stacks.map((stack) => ({
        ...stack,
        uncertainty: stack.uncertainty || null,
      })),
      overallConfidence: overallConfidence(parsed.data.stacks),
      guidance: parsed.data.guidance || null,
    });
    res.json(result);
  } catch (error) {
    // Do not include provider text, prompt, request body, or image bytes in logs.
    if (error instanceof ChipAnalysisTimeoutError) {
      req.log.warn({ category: "provider_timeout" }, "Chip scan analysis timed out");
      res.status(502).json({ error: "Image analysis service timed out" });
      return;
    }
    req.log.warn(
      { category: "provider_or_validation" },
      "Chip scan analysis failed",
    );
    res.status(502).json({ error: "Image analysis service failed" });
  }
});

export default router;