import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface HierarchyItem {
  path: string;
  name: string;
  iter_number: number | null;
  modeling: boolean | null;
}

interface ExperimentBlockModalProps {
  vaultPath: string;
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called with the experiment name (as it should appear in the block
   * header) and iteration number. The caller inserts the block scaffold
   * into the editor at the cursor.
   */
  onConfirm: (experimentName: string, iterNumber: number) => void;
}

/**
 * Modal triggered by the `+ Block` sidebar button or Ctrl+Shift+B.
 *
 * Picks an experiment + iteration to scaffold an `::experiment` block
 * in the current editor. The modal does NOT touch the editor; it just
 * collects the two fields and hands them back via `onConfirm`. The
 * caller (App.tsx) does the actual insertion through the editor ref so
 * the cursor lands inside the block.
 */
export function ExperimentBlockModal({
  vaultPath,
  isOpen,
  onClose,
  onConfirm,
}: ExperimentBlockModalProps) {
  const [experiments, setExperiments] = useState<HierarchyItem[]>([]);
  const [experimentPath, setExperimentPath] = useState<string>("");
  const [iterNumber, setIterNumber] = useState<number>(1);
  const [maxIter, setMaxIter] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Load experiment list on open.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setExperimentPath("");
    setMaxIter(0);
    setIterNumber(1);
    invoke<HierarchyItem[]>("list_experiments", {
      vaultPath,
      projectPath: null,
    })
      .then((list) => setExperiments(list))
      .catch((e) => setError(`Could not load experiments: ${e}`));
  }, [isOpen, vaultPath]);

  // When the experiment selection changes, fetch its iterations to
  // suggest "next: iter-N+1".
  useEffect(() => {
    if (!experimentPath) return;
    invoke<{
      kind: string;
      parent: HierarchyItem | null;
      siblings: HierarchyItem[];
    }>("get_hierarchy_context", {
      vaultPath,
      currentPath: experimentPath,
    })
      .then((ctx) => {
        const max = ctx.siblings
          .map((s) => s.iter_number ?? 0)
          .reduce((a, b) => Math.max(a, b), 0);
        setMaxIter(max);
        // Default to the LATEST EXISTING iteration. If you want to
        // route into a brand-new iter, type `max + 1` or higher in the
        // input — the Rust side auto-creates the file. But by default
        // most uses are "log into the iter I'm currently working on".
        setIterNumber(max > 0 ? max : 1);
      })
      .catch((e) => console.warn("get_hierarchy_context failed:", e));
  }, [experimentPath, vaultPath]);

  if (!isOpen) return null;

  const selectedExperiment = experiments.find((e) => e.path === experimentPath);

  function submit() {
    if (!selectedExperiment) {
      setError("Pick an experiment.");
      return;
    }
    if (!Number.isFinite(iterNumber) || iterNumber < 1) {
      setError("Iteration number must be ≥ 1.");
      return;
    }
    // Use the experiment's title (or folder basename if untitled) as the
    // name in the block header. Rust's find_iteration_path matches both.
    onConfirm(selectedExperiment.name, iterNumber);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div style={styles.scrim} onClick={onClose}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
        role="dialog"
        aria-label="Insert experiment block"
      >
        <h2 style={styles.heading}>Insert experiment block</h2>

        <label style={styles.label}>
          <span style={styles.labelText}>Experiment</span>
          <select
            value={experimentPath}
            onChange={(e) => setExperimentPath(e.target.value)}
            style={styles.input}
          >
            <option value="">Choose an experiment…</option>
            {experiments.map((e) => (
              <option key={e.path} value={e.path}>
                {e.name}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.label}>
          <span style={styles.labelText}>
            Iteration{" "}
            {selectedExperiment && maxIter > 0 && (
              <span style={styles.hint}>
                (existing: 1–{maxIter}; type {maxIter + 1}+ to auto-create a new
                iteration)
              </span>
            )}
          </span>
          <input
            type="number"
            min={1}
            value={iterNumber}
            onChange={(e) => setIterNumber(parseInt(e.target.value, 10) || 1)}
            style={styles.input}
          />
        </label>

        <p style={styles.hint}>
          Inserts{" "}
          <code style={styles.codeInline}>::experiment NAME / iter-N</code> and{" "}
          <code style={styles.codeInline}>::end</code> at the cursor. On save,
          content between them routes to the iteration's "From daily notes"
          section.
        </p>

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.btnGhost}>
            Cancel
          </button>
          <button onClick={submit} style={styles.btnPrimary}>
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    background: "var(--scrim)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  panel: {
    minWidth: "440px",
    maxWidth: "560px",
    padding: "1.5rem 1.75rem",
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    boxShadow: "var(--shadow)",
  },
  heading: { margin: "0 0 1rem", fontSize: "1.1rem", fontWeight: 600 },
  label: { display: "block", marginBottom: "0.85rem" },
  labelText: {
    display: "block",
    fontSize: "0.78rem",
    color: "var(--text-2)",
    marginBottom: "0.25rem",
  },
  input: {
    width: "100%",
    padding: "0.45rem 0.6rem",
    fontSize: "0.9rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
    outline: "none",
    boxSizing: "border-box",
  },
  hint: {
    fontSize: "0.8rem",
    color: "var(--text-muted)",
    lineHeight: 1.5,
    margin: "0.5rem 0",
  },
  codeInline: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    background: "var(--code-bg)",
    padding: "1px 4px",
    borderRadius: "3px",
    fontSize: "0.85em",
  },
  error: { margin: "0.5rem 0", color: "var(--danger)", fontSize: "0.85rem" },
  footer: {
    marginTop: "1.25rem",
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.5rem",
  },
  btnGhost: {
    padding: "5px 14px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  btnPrimary: {
    padding: "5px 16px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "var(--primary)",
    color: "white",
    border: "none",
    borderRadius: "4px",
  },
};
