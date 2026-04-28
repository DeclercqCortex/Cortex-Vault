import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type HierarchyKind =
  | "project"
  | "experiment"
  | "iteration"
  | "note"
  | "idea"
  | "method"
  | "protocol";

const METHOD_DOMAINS = [
  "modeling",
  "wet-lab",
  "dry-lab",
  "data-analysis",
  "writing",
] as const;
// Protocols use the same domain taxonomy as methods.
const PROTOCOL_DOMAINS = METHOD_DOMAINS;

interface HierarchyItem {
  path: string;
  name: string;
  iter_number: number | null;
  modeling: boolean | null;
}

interface NewHierarchyModalProps {
  vaultPath: string;
  /** Which hierarchy level we're creating. */
  kind: HierarchyKind | null;
  /** Pre-selected parent path (e.g., from current selection context). */
  defaultParent?: string;
  onClose: () => void;
  /** Called with the new file's absolute path after successful creation. */
  onCreated: (path: string) => void;
}

/**
 * Modal for creating a project, experiment, or iteration.
 *
 *   project    → just a name
 *   experiment → name + project picker + modeling toggle
 *   iteration  → experiment picker (name auto-derived from date)
 */
export function NewHierarchyModal({
  vaultPath,
  kind,
  defaultParent,
  onClose,
  onCreated,
}: NewHierarchyModalProps) {
  const [name, setName] = useState("");
  const [parentPath, setParentPath] = useState<string>(defaultParent ?? "");
  const [modeling, setModeling] = useState(false);
  const [methodDomain, setMethodDomain] = useState<string>("modeling");
  const [methodComplexity, setMethodComplexity] = useState<number>(3);
  const [protocolDomain, setProtocolDomain] = useState<string>("wet-lab");
  const [parents, setParents] = useState<HierarchyItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Load parent options for experiments and iterations.
  useEffect(() => {
    if (!kind) return;
    setName("");
    setError(null);
    setParentPath(defaultParent ?? "");

    if (kind === "experiment") {
      invoke<HierarchyItem[]>("list_projects", { vaultPath })
        .then(setParents)
        .catch((e) => setError(`Could not load projects: ${e}`));
    } else if (kind === "iteration") {
      invoke<HierarchyItem[]>("list_experiments", {
        vaultPath,
        projectPath: null,
      })
        .then(setParents)
        .catch((e) => setError(`Could not load experiments: ${e}`));
    }

    setTimeout(() => nameRef.current?.focus(), 0);
  }, [kind, vaultPath, defaultParent]);

  if (!kind) return null;

  const todayLocal = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  async function submit() {
    setError(null);
    if (busy) return;

    if (kind === "note") {
      if (!name.trim()) {
        setError("Enter a note name.");
        return;
      }
      setBusy(true);
      try {
        const path = await invoke<string>("create_note", {
          vaultPath,
          name: name.trim(),
          dateIso: todayLocal(),
        });
        onCreated(path);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (kind === "idea") {
      if (!name.trim()) {
        setError("Enter an idea name.");
        return;
      }
      setBusy(true);
      try {
        const path = await invoke<string>("create_idea", {
          vaultPath,
          name: name.trim(),
          dateIso: todayLocal(),
        });
        onCreated(path);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (kind === "method") {
      if (!name.trim()) {
        setError("Enter a method name.");
        return;
      }
      setBusy(true);
      try {
        const path = await invoke<string>("create_method", {
          vaultPath,
          name: name.trim(),
          domain: methodDomain,
          complexity: methodComplexity,
          dateIso: todayLocal(),
        });
        onCreated(path);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (kind === "protocol") {
      if (!name.trim()) {
        setError("Enter a protocol name.");
        return;
      }
      setBusy(true);
      try {
        const path = await invoke<string>("create_protocol", {
          vaultPath,
          name: name.trim(),
          domain: protocolDomain,
          dateIso: todayLocal(),
        });
        onCreated(path);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (kind === "project") {
      if (!name.trim()) {
        setError("Enter a project name.");
        return;
      }
      setBusy(true);
      try {
        const path = await invoke<string>("create_project", {
          vaultPath,
          name: name.trim(),
          dateIso: todayLocal(),
        });
        onCreated(path);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    } else if (kind === "experiment") {
      if (!name.trim()) {
        setError("Enter an experiment name.");
        return;
      }
      if (!parentPath) {
        setError("Pick a project.");
        return;
      }
      setBusy(true);
      try {
        const path = await invoke<string>("create_experiment", {
          vaultPath,
          projectPath: parentPath,
          name: name.trim(),
          modeling,
          dateIso: todayLocal(),
        });
        onCreated(path);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    } else {
      // iteration
      if (!parentPath) {
        setError("Pick an experiment.");
        return;
      }
      setBusy(true);
      try {
        const path = await invoke<string>("create_iteration", {
          vaultPath,
          experimentPath: parentPath,
          dateIso: todayLocal(),
        });
        onCreated(path);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const heading =
    kind === "project"
      ? "New project"
      : kind === "experiment"
        ? "New experiment"
        : kind === "iteration"
          ? "New iteration"
          : kind === "idea"
            ? "New idea"
            : kind === "method"
              ? "New method"
              : kind === "protocol"
                ? "New protocol"
                : "New note";

  const showName = kind !== "iteration";
  // Notes (root) and ideas (04-Ideas/) go in fixed locations with no
  // picker; only experiments and iterations need a parent.
  const showParent = kind === "experiment" || kind === "iteration";

  return (
    <div style={styles.scrim} onClick={onClose}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
        role="dialog"
        aria-label={heading}
      >
        <h2 style={styles.heading}>{heading}</h2>

        {showName && (
          <label style={styles.label}>
            <span style={styles.labelText}>Name</span>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                kind === "project"
                  ? "e.g., Mean-field tumor modeling"
                  : kind === "note"
                    ? "e.g., Reading notes — Strogatz Ch 3"
                    : kind === "idea"
                      ? "e.g., Mean-field misses spatial heterogeneity"
                      : kind === "method"
                        ? "e.g., Spectral collocation on Chebyshev grid"
                        : kind === "protocol"
                          ? "e.g., PBS wash for adherent cells"
                          : "e.g., Validate boundary conditions"
              }
              style={styles.input}
            />
          </label>
        )}

        {showParent && (
          <label style={styles.label}>
            <span style={styles.labelText}>
              {kind === "experiment" ? "Project" : "Experiment"}
            </span>
            <select
              value={parentPath}
              onChange={(e) => setParentPath(e.target.value)}
              style={styles.input}
            >
              <option value="">
                {kind === "experiment"
                  ? "Choose a project…"
                  : "Choose an experiment…"}
              </option>
              {parents.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {kind === "experiment" && (
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={modeling}
              onChange={(e) => setModeling(e.target.checked)}
            />
            <span style={styles.labelText}>Modeling experiment</span>
            <span style={styles.hint}>
              (rather than wet-/dry-lab — affects template later)
            </span>
          </label>
        )}

        {kind === "method" && (
          <>
            <label style={styles.label}>
              <span style={styles.labelText}>Domain</span>
              <select
                value={methodDomain}
                onChange={(e) => setMethodDomain(e.target.value)}
                style={styles.input}
              >
                {METHOD_DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label style={styles.label}>
              <span style={styles.labelText}>Complexity (1–5)</span>
              <select
                value={methodComplexity}
                onChange={(e) => setMethodComplexity(Number(e.target.value))}
                style={styles.input}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "(trivial)" : n === 5 ? "(hairy)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {kind === "protocol" && (
          <label style={styles.label}>
            <span style={styles.labelText}>Domain</span>
            <select
              value={protocolDomain}
              onChange={(e) => setProtocolDomain(e.target.value)}
              style={styles.input}
            >
              {PROTOCOL_DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}

        {kind === "iteration" && (
          <p style={styles.hint}>
            Iteration filename will be{" "}
            <code style={styles.codeInline}>iter-NN - {todayLocal()}.md</code>{" "}
            in the chosen experiment's folder.
          </p>
        )}

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.btnGhost} disabled={busy}>
            Cancel
          </button>
          <button onClick={submit} style={styles.btnPrimary} disabled={busy}>
            {busy ? "Creating…" : "Create"}
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
  heading: {
    margin: "0 0 1rem",
    fontSize: "1.1rem",
    fontWeight: 600,
  },
  label: {
    display: "block",
    marginBottom: "0.85rem",
  },
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
  checkboxRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.5rem",
    marginBottom: "0.85rem",
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
  error: {
    margin: "0.5rem 0",
    color: "var(--danger)",
    fontSize: "0.85rem",
  },
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
