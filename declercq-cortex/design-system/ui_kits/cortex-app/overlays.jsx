/* Cortex overlays — Welcome card, Modal, Command palette, Splash */

function Welcome({ onPick }) {
  return (
    <div className="scrim" onClick={onPick}>
      <div className="welcome" onClick={e=>e.stopPropagation()}>
        <div className="mark">
          <img src="../../assets/cortex-mark.svg" alt=""/>
          <span className="word">Cortex</span>
        </div>
        <h1>Welcome to Cortex</h1>
        <p>A local-first research notebook. Pick a folder of markdown files to begin — every note, experiment, and protocol lives on disk.</p>
        <button className="cta" onClick={onPick}>Choose vault folder</button>
        <div className="hint">Ctrl+K to search · Ctrl+/ for shortcuts</div>
      </div>
    </div>
  );
}

function Modal({ onClose }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="h">
          <span className="t">Insert experiment block</span>
          <button className="iconBtn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="b">
          Wraps the selected paragraphs in a typed block (header · body · end strip). Use <code>Ctrl+Shift+B</code> to insert at caret. Header text becomes the block title; body is the iteration notes.
        </div>
        <div className="f">
          <button className="btnSec" onClick={onClose}>Cancel</button>
          <button className="btnPri" onClick={onClose}>Insert</button>
        </div>
      </div>
    </div>
  );
}

function CommandPalette({ onClose }) {
  const items = [
    { ico: "+", label: "New note", kbd: "Ctrl+N" },
    { ico: "+", label: "New experiment", kbd: "Ctrl+Shift+E" },
    { ico: "▸", label: "Insert experiment block", kbd: "Ctrl+Shift+B" },
    { ico: "⌕", label: "Search vault…", kbd: "Ctrl+K" },
    { ico: "📅", label: "Open today's daily log", kbd: "Ctrl+D" },
    { ico: "↻", label: "Refresh file tree", kbd: "Ctrl+R" },
    { ico: "?", label: "Keyboard shortcuts", kbd: "Ctrl+/" },
  ];
  const [sel, setSel] = React.useState(0);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal cmd" onClick={e=>e.stopPropagation()}>
        <input className="input" autoFocus placeholder="Search notes, run command…" />
        <ul>
          {items.map((it,i)=>
            <li key={i} className={i===sel?"sel":""} onMouseEnter={()=>setSel(i)} onClick={onClose}>
              <span className="ico">{it.ico}</span>
              <span>{it.label}</span>
              <span className="kbd">{it.kbd}</span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Splash({ onDone }) {
  // 7 orbits — each ray sweeps a different tilted plane in 3D.
  // Hues + timings staggered to evoke the Win7 sleep ribbon dance.
  const orbits = [
    { rx: 14,  ry:  22, rz:   8, dur: 7.2,  delay: 0,    hue: "blue",   thick: 3, len: 78 },
    { rx: -38, ry:  56, rz: -22, dur: 9.4,  delay: -1.1, hue: "violet", thick: 2, len: 72 },
    { rx: 62,  ry: -18, rz:  44, dur: 11.8, delay: -3.4, hue: "teal",   thick: 4, len: 84 },
    { rx: -72, ry:  -8, rz:  18, dur: 8.6,  delay: -2.0, hue: "blue",   thick: 2, len: 66 },
    { rx: 28,  ry:  84, rz: -36, dur: 13.2, delay: -5.1, hue: "violet", thick: 3, len: 80 },
    { rx: -16, ry: -54, rz:  72, dur: 10.0, delay: -0.6, hue: "teal",   thick: 2, len: 70 },
    { rx: 88,  ry:  32, rz: -52, dur: 14.6, delay: -4.2, hue: "blue",   thick: 4, len: 88 },
  ];

  return (
    <div className="splash" onClick={onDone}>
      <div className="splash-vignette"/>

      <div className="splash-scene">
        <div className="splash-stage">
          {orbits.map((o,i) => (
            <div
              key={i}
              className={`splash-orbit hue-${o.hue}`}
              style={{
                "--rx": `${o.rx}deg`,
                "--ry": `${o.ry}deg`,
                "--rz": `${o.rz}deg`,
                "--dur": `${o.dur}s`,
                "--delay": `${o.delay}s`,
              }}
            >
              <div
                className="splash-ray"
                style={{
                  "--thick": `${o.thick}px`,
                  "--len": `${o.len}%`,
                }}
              />
            </div>
          ))}

          <div className="splash-core">
            <div className="splash-core-glow"/>
            <div className="splash-core-ring"/>
            <img src="../../assets/cortex-mark.svg" alt=""/>
          </div>
        </div>
      </div>

      <div className="splash-word">Cortex</div>
      <div className="splash-tag">cluster 26 · cerebrum</div>
    </div>
  );
}

Object.assign(window, { Welcome, Modal, CommandPalette, Splash });
