import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      data-testid="button-theme-toggle"
      className="h-10 w-10 shrink-0"
    >
      {isDark ? <Sun className="h-4 w-4" strokeWidth={3} /> : <Moon className="h-4 w-4" strokeWidth={3} />}
    </Button>
  );
}