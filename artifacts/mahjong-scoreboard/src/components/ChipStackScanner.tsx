import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Camera, Image as ImageIcon, AlertCircle, Plus, Minus, RotateCcw, Check, Loader2, ScanSearch } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAnalyzeChipStacks } from "@workspace/api-client-react";
import type { ChipDenomination } from "@workspace/api-client-react";
import { prepareImage } from "@/lib/image-utils";
import { parseScanResult, calculateGrandTotal, calculateSubtotals, CHIP_VALUES, CHIP_NAMES, clampCount } from "@/lib/chip-calculator";
import type { ChipCountMap, ChipUncertaintyMap, ChipConfidenceMap } from "@/lib/chip-calculator";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type ChipStackScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerName: string;
  onApply: (amount: number) => void;
};

const DENOMINATIONS: ChipDenomination[] = ["white", "orange", "light_blue", "blue", "black"];
const CHIP_SWATCHES: Record<ChipDenomination, string> = {
  white: "bg-white",
  orange: "bg-orange-400",
  light_blue: "bg-sky-200",
  blue: "bg-blue-600",
  black: "bg-black",
};

function readNumberProperty(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const property = Reflect.get(value, key);
  return typeof property === "number" ? property : undefined;
}

function readErrorDetail(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = Reflect.get(value, "data");
  if (!data || typeof data !== "object") return undefined;
  const detail = Reflect.get(data, "error");
  return typeof detail === "string" && detail.trim() ? detail.trim() : undefined;
}

function getApiErrorMessage(error: unknown): string {
  const status = readNumberProperty(error, "status");
  const detail = readErrorDetail(error);
  const message = error instanceof Error ? error.message : "";

  if (status === 401 || status === 403) {
    return "Your admin session expired or is not authorized. Sign in again and retry.";
  }
  if (status === 413) {
    return "The prepared photo is too large. Retake it a little farther away.";
  }
  if (status === 422) {
    return detail ?? "Separate every stack and show each one fully from top to bottom.";
  }
  if (
    status === 502 ||
    status === 504 ||
    message.toLowerCase().includes("timeout")
  ) {
    return "The counting service is temporarily unavailable. Your photo was not saved; please retry.";
  }
  if (status === 400) {
    return detail ?? "The photo could not be read. Please retake it.";
  }
  return "The photo could not be analyzed. Check your connection and try again.";
}

export function ChipStackScanner({ open, onOpenChange, playerName, onApply }: ChipStackScannerProps) {
  const [step, setStep] = useState<"capture" | "preview" | "analyzing" | "review" | "error">("capture");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageData, setImageData] = useState<{ base64: string, mimeType: "image/jpeg" } | null>(null);
  
  const [counts, setCounts] = useState<ChipCountMap>({ white: 0, orange: 0, light_blue: 0, blue: 0, black: 0 });
  const [warnings, setWarnings] = useState<ChipUncertaintyMap>({ white: [], orange: [], light_blue: [], blue: [], black: [] });
  const [confidences, setConfidences] = useState<ChipConfidenceMap>({ white: null, orange: null, light_blue: null, blue: null, black: null });
  const [overallConfidence, setOverallConfidence] = useState<number | null>(null);
  
  const [guidance, setGuidance] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  
  const analyzeChips = useAnalyzeChipStacks();

  const resetState = useCallback(() => {
    setStep("capture");
    setImageSrc(null);
    setImageData(null);
    setCounts({ white: 0, orange: 0, light_blue: 0, blue: 0, black: 0 });
    setWarnings({ white: [], orange: [], light_blue: [], blue: [], black: [] });
    setConfidences({ white: null, orange: null, light_blue: null, blue: null, black: null });
    setOverallConfidence(null);
    setGuidance(null);
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (fallbackInputRef.current) fallbackInputRef.current.value = "";
  }, []);

  useEffect(() => {
    if (open) resetState();
  }, [open, resetState]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setStep("analyzing"); // temporary feedback while client-side processing handles large files
      const prepped = await prepareImage(file, 1600);
      setImageData(prepped);
      setImageSrc(`data:${prepped.mimeType};base64,${prepped.base64}`);
      setStep("preview");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to process the image.");
      setStep("error");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (fallbackInputRef.current) fallbackInputRef.current.value = "";
    }
  };

  const handleAnalyze = async () => {
    if (!imageData) return;
    
    setStep("analyzing");
    try {
      const result = await analyzeChips.mutateAsync({
        data: {
          imageBase64: imageData.base64,
          mimeType: imageData.mimeType,
        }
      });

      const parsed = parseScanResult(result.stacks);
      setCounts(parsed.counts);
      setWarnings(parsed.warnings);
      setConfidences(parsed.confidences);
      setOverallConfidence(result.overallConfidence);
      setGuidance(result.guidance || null);
      
      setStep("review");
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err));
      setStep("error");
    }
  };

  const updateCount = (denom: ChipDenomination, value: number) => {
    setCounts(prev => ({
      ...prev,
      [denom]: clampCount(value)
    }));
  };

  const total = calculateGrandTotal(counts);
  const subtotals = calculateSubtotals(counts);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md p-0 gap-0 border-4 border-ink brutal-shadow-lg rounded-none bg-background">
        <DialogHeader className="p-6 pb-4 border-b-4 border-ink bg-tile sticky top-0 z-10">
          <DialogTitle className="font-black uppercase tracking-wide text-xl text-foreground font-sans">
            Scan Chips for {playerName}
          </DialogTitle>
          <DialogDescription className="font-bold text-muted-foreground text-sm">
            {step === "capture" && "Take a clear, side-angle photo of separate stacks."}
            {step === "preview" && "Ready to count these stacks?"}
            {step === "analyzing" && (imageData ? "Counting your chips..." : "Preparing your photo...")}
            {step === "review" && "Review and correct the detected counts."}
            {step === "error" && "Something went wrong."}
          </DialogDescription>
        </DialogHeader>

        <div className="p-6">
          {step === "capture" && (
            <div className="flex flex-col gap-6">
              <div className="bg-secondary/20 border-2 border-secondary text-secondary-foreground p-4 brutal-shadow-sm space-y-2">
                <h4 className="font-black uppercase tracking-wide text-sm flex items-center gap-2">
                  <Camera className="w-4 h-4" /> Good Photo Guidelines
                </h4>
                <ul className="text-sm font-medium space-y-1 list-disc list-inside">
                  <li>Keep stacks of the same color separate</li>
                  <li>Ensure stacks don't block each other</li>
                  <li>Take photo from a side angle</li>
                  <li>Keep full top-to-bottom visibility</li>
                  <li>Ensure good lighting</li>
                </ul>
              </div>

              <div className="flex flex-col gap-4 mt-2">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  data-testid="input-camera"
                />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  ref={fallbackInputRef}
                  onChange={handleFileChange}
                  data-testid="input-file"
                />
                
                <Button 
                  type="button"
                  size="lg" 
                  className="h-24 text-lg border-4 border-ink bg-primary text-primary-foreground brutal-shadow hover:-translate-y-1 hover:-translate-x-1 active:translate-y-0 active:translate-x-0 transition-all font-black"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-take-photo"
                >
                  <Camera className="w-8 h-8 mr-2" />
                  TAKE PHOTO
                </Button>
                
                <Button 
                  type="button"
                  variant="outline" 
                  size="lg"
                  className="h-16 border-2 border-ink brutal-shadow-sm font-bold uppercase tracking-wide"
                  onClick={() => fallbackInputRef.current?.click()}
                  data-testid="button-upload-photo"
                >
                  <ImageIcon className="w-5 h-5 mr-2" />
                  Or upload from gallery
                </Button>
              </div>
            </div>
          )}

          {step === "preview" && imageSrc && (
            <div className="flex flex-col gap-6">
              <div className="relative w-full aspect-square sm:aspect-video border-4 border-ink bg-muted brutal-shadow-sm overflow-hidden flex items-center justify-center">
                <img
                  src={imageSrc}
                  alt="Chip stack photo preview"
                  className="object-contain w-full h-full"
                  data-testid="img-chip-preview"
                />
              </div>
              
              <div className="flex gap-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  className="flex-1 border-2 border-ink brutal-shadow-sm font-bold uppercase"
                  onClick={resetState}
                  data-testid="button-retake-preview"
                >
                  <RotateCcw className="w-4 h-4 mr-2" /> Retake
                </Button>
                
                <Button 
                  type="button" 
                  className="flex-[2] border-4 border-ink bg-primary text-primary-foreground brutal-shadow hover:-translate-y-1 hover:-translate-x-1 active:translate-y-0 active:translate-x-0 transition-all font-black uppercase text-base"
                  onClick={handleAnalyze}
                  data-testid="button-analyze-stacks"
                >
                  <ScanSearch className="w-5 h-5 mr-2" /> Analyze
                </Button>
              </div>
            </div>
          )}

          {step === "analyzing" && (
            <div className="flex flex-col items-center justify-center py-12 gap-6">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping"></div>
                <div className="w-20 h-20 bg-primary border-4 border-ink rounded-full flex items-center justify-center brutal-shadow animate-pulse">
                  <Loader2 className="w-10 h-10 text-primary-foreground animate-spin" />
                </div>
              </div>
              <p className="font-black text-lg uppercase tracking-widest text-center animate-pulse">
                {imageData ? "Analyzing stacks..." : "Preparing photo..."}
              </p>
            </div>
          )}

          {step === "error" && (
            <div className="flex flex-col items-center gap-6 py-6 text-center">
              <div className="w-20 h-20 bg-destructive border-4 border-ink rounded-full flex items-center justify-center brutal-shadow-sm">
                <AlertCircle className="w-10 h-10 text-destructive-foreground" />
              </div>
              <div className="space-y-2">
                <h3 className="font-black text-xl uppercase tracking-wide text-destructive">Analysis Failed</h3>
                <p className="font-bold text-muted-foreground" data-testid="status-scan-error">
                  {errorMessage}
                </p>
              </div>
              
              <Button 
                type="button"
                onClick={resetState} 
                size="lg"
                className="mt-4 border-2 border-ink brutal-shadow-sm font-black uppercase tracking-wide"
                data-testid="button-try-again"
              >
                <RotateCcw className="w-5 h-5 mr-2" />
                Try Again
              </Button>
            </div>
          )}

          {step === "review" && (
            <div className="flex flex-col gap-6">
              {imageSrc && (
                <div className="relative w-full aspect-video border-4 border-ink bg-muted brutal-shadow-sm overflow-hidden flex items-center justify-center">
                  <img
                    src={imageSrc}
                    alt="Analyzed chip stacks"
                    className="object-contain w-full h-full"
                    data-testid="img-analyzed-chips"
                  />
                </div>
              )}
              
              {overallConfidence !== null && (
                <div className="flex justify-between items-center bg-card border-2 border-ink p-3 brutal-shadow-sm">
                  <span className="font-black uppercase tracking-wide text-sm">Overall Scan Confidence</span>
                  <span
                    className={cn("font-black text-lg", overallConfidence >= 0.8 ? "text-primary" : "text-secondary-foreground")}
                    data-testid="text-overall-confidence"
                  >
                    {Math.round(overallConfidence * 100)}%
                  </span>
                </div>
              )}

              {guidance && (
                <div className="bg-secondary/20 border-2 border-secondary text-secondary-foreground p-3 brutal-shadow-sm flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm font-bold" data-testid="text-scan-guidance">{guidance}</p>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-5 gap-2 pb-2 border-b-4 border-ink">
                  <div className="col-span-2 font-black uppercase tracking-wide text-xs">Chip</div>
                  <div className="col-span-2 font-black uppercase tracking-wide text-xs text-center">Count</div>
                  <div className="col-span-1 font-black uppercase tracking-wide text-xs text-right">Total</div>
                </div>

                {DENOMINATIONS.map((denom) => {
                  const denomWarnings = warnings[denom];
                  const hasWarning = denomWarnings && denomWarnings.length > 0;
                  const detectedConfidence = confidences[denom];
                  const isDetected = detectedConfidence !== null;
                  
                  return (
                    <div key={denom} className={cn(
                      "flex flex-col gap-2 p-2 border-2",
                      isDetected ? "border-ink bg-card brutal-shadow-sm" : "border-muted-foreground/30 bg-muted/30"
                    )}>
                      <div className="grid grid-cols-5 gap-2 items-center">
                        <div className="col-span-2 flex flex-col">
                          <span className="flex items-center gap-2 font-black text-sm uppercase tracking-wide leading-tight">
                            <span
                              aria-hidden="true"
                              className={cn("h-4 w-4 shrink-0 rounded-full border-2 border-ink", CHIP_SWATCHES[denom])}
                            />
                            {CHIP_NAMES[denom]}
                          </span>
                          <span className="font-bold text-xs text-muted-foreground">${CHIP_VALUES[denom]}</span>
                          {isDetected ? (
                            <span
                              className={cn("text-[10px] font-bold mt-1", detectedConfidence >= 0.8 ? "text-primary" : "text-secondary-foreground")}
                              data-testid={`text-confidence-${denom}`}
                            >
                              Conf: {Math.round(detectedConfidence * 100)}%
                            </span>
                          ) : (
                            <span
                              className="text-[10px] font-bold text-muted-foreground mt-1"
                              data-testid={`text-confidence-${denom}`}
                            >
                              Not detected
                            </span>
                          )}
                        </div>
                        
                        <div className="col-span-2 flex items-center justify-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 border-2 border-ink brutal-shadow-sm shrink-0"
                            onClick={() => updateCount(denom, (counts[denom] || 0) - 1)}
                            disabled={(counts[denom] || 0) <= 0}
                            aria-label={`Remove one ${CHIP_NAMES[denom]} chip`}
                            data-testid={`button-minus-${denom}`}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          
                          <Input
                            type="number"
                            min="0"
                            max="500"
                            step="1"
                            inputMode="numeric"
                            value={counts[denom] || 0}
                            onChange={(e) => updateCount(denom, parseInt(e.target.value) || 0)}
                            className="h-8 w-16 text-center font-mono font-bold border-2 border-ink p-0"
                            data-testid={`input-count-${denom}`}
                          />
                          
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 border-2 border-ink brutal-shadow-sm shrink-0"
                            onClick={() => updateCount(denom, (counts[denom] || 0) + 1)}
                            disabled={(counts[denom] || 0) >= 500}
                            aria-label={`Add one ${CHIP_NAMES[denom]} chip`}
                            data-testid={`button-plus-${denom}`}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        
                        <div
                          className="col-span-1 text-right font-mono font-black text-sm"
                          data-testid={`text-subtotal-${denom}`}
                        >
                          ${subtotals[denom]}
                        </div>
                      </div>
                      
                      {hasWarning && isDetected && (
                        <div className="text-xs font-bold text-destructive flex items-start gap-1 mt-1 bg-destructive/10 p-1.5 border-2 border-destructive/20">
                          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                          <span>
                             Uncertain read. {denomWarnings[0].uncertainty || "Please verify this count."}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {step === "review" && (
          <div className="p-6 pt-4 border-t-4 border-ink bg-tile sticky bottom-0 z-10 flex flex-col gap-4">
            <div className="flex justify-between items-center px-4 py-3 bg-card border-4 border-ink brutal-shadow-sm">
              <span className="font-black uppercase tracking-widest">Grand Total</span>
              <span className="font-mono font-black text-2xl text-primary" data-testid="text-grand-total">
                ${total}
              </span>
            </div>
            
            <div className="flex gap-4">
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-2 border-ink brutal-shadow-sm font-bold uppercase"
                onClick={resetState}
                data-testid="button-retake"
              >
                <RotateCcw className="w-4 h-4 mr-2" /> Retake
              </Button>
              
              <Button
                type="button"
                className="flex-[2] border-4 border-ink brutal-shadow hover:-translate-y-1 hover:-translate-x-1 active:translate-y-0 active:translate-x-0 transition-all font-black uppercase text-base"
                onClick={() => {
                  onApply(total);
                  onOpenChange(false);
                }}
                data-testid="button-apply-total"
              >
                <Check className="w-5 h-5 mr-2" /> Apply ${total}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
