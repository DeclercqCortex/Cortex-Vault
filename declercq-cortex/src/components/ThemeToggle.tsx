import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "cortex:theme";

/**
 * Resolve "system" to the OS preference, otherwise pass through.
 */
function resolveTheme(t: Theme): "light" | "dark" {
  if (t === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return t;
}

/**
 * Toggle the `light` / `dark` class on <html>. CSS in index.css drives
 * everything else off these classes via the :root.light / :root.dark
 * blocks.
 */
function applyTheme(applied: "light" | "dark") {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(applied);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
    return "system";
  });

  // Apply on mount and whenever the user picks a setting.
  useEffect(() => {
    applyTheme(resolveTheme(theme));
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Follow OS changes when user is on "system".
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return { theme, setTheme };
}

interface ThemeToggleProps {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

/**
 * 3-way segmented selector. Compact enough to live in the sidebar header
 * or footer alongside the other small controls.
 */
export function ThemeToggle({ theme, setTheme }: ThemeToggleProps) {
  const options: Array<{ value: Theme; label: string; title: string }> = [
    { value: "system", label: "Auto", title: "Follow system preference" },
    { value: "light", label: "Light", title: "Force light theme" },
    { value: "dark", label: "Dark", title: "Force dark theme" },
  ];

  return (
    <div style={styles.group} role="radiogroup" aria-label="Theme">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={theme === opt.value}
          title={opt.title}
          onClick={() => setTheme(opt.value)}
          style={{
            ...styles.option,
            background:
              theme === opt.value ? "var(--accent-bg-2)" : "transparent",
            color: theme === opt.value ? "var(--accent)" : "var(--text-2)",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  group: {
    display: "inline-flex",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
    overflow: "hidden",
  },
  option: {
    fontSize: "0.7rem",
    padding: "2px 8px",
    cursor: "pointer",
    border: "none",
    borderRight: "1px solid var(--border-2)",
  },
};
