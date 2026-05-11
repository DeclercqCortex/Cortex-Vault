/* Cortex chrome components — Toolbar, Sidebar, FileTree, Bell, ThemeToggle */

const { useState } = React;

function Brand() {
  return (
    <div className="brand">
      <img src="../../assets/cortex-mark.svg" alt="Cortex" />
      <span>Cortex</span>
    </div>
  );
}

function ToolbarBtn({ children, active, icon, title }) {
  return (
    <button className={`tBtn${active ? " active" : ""}${icon ? " icon" : ""}`} title={title}>
      {children}
    </button>
  );
}

function EditorToolbar({ onOpenCmd, onOpenModal }) {
  return (
    <div className="editorToolbar">
      <Brand />
      <ToolbarBtn active title="Bold (Ctrl+B)"><b>B</b></ToolbarBtn>
      <ToolbarBtn title="Italic (Ctrl+I)"><i>I</i></ToolbarBtn>
      <ToolbarBtn title="Underline (Ctrl+U)"><u>U</u></ToolbarBtn>
      <ToolbarBtn title="Strikethrough"><s>S</s></ToolbarBtn>
      <div className="tSep"/>
      <ToolbarBtn title="Heading 1">H1</ToolbarBtn>
      <ToolbarBtn title="Heading 2">H2</ToolbarBtn>
      <ToolbarBtn title="Heading 3">H3</ToolbarBtn>
      <div className="tSep"/>
      <ToolbarBtn icon title="Bullet list">≡</ToolbarBtn>
      <ToolbarBtn icon title="Insert table">⊞</ToolbarBtn>
      <ToolbarBtn icon title="Insert experiment block (Ctrl+Shift+B)">▸</ToolbarBtn>
      <ToolbarBtn icon title="Code block">{"</>"}</ToolbarBtn>
      <div className="tSep"/>
      <ToolbarBtn title="Font">Inter ▾</ToolbarBtn>
      <ToolbarBtn title="Font size">15 ▾</ToolbarBtn>
      <div className="tSpacer"/>
      <button className="tBtn flat" onClick={onOpenCmd} title="Search notes (Ctrl+K)">
        <span style={{opacity:.7}}>⌕</span> Search <span style={{opacity:.5,fontFamily:"var(--font-mono)",fontSize:11}}>Ctrl+K</span>
      </button>
      <ToolbarBtn icon title="Insert (modal demo)" >+</ToolbarBtn>
      <ThemeToggle/>
      <NotificationBell/>
    </div>
  );
}

function ThemeToggle() {
  const [m, set] = useState("Dark");
  return (
    <div className="segToggle" role="tablist" aria-label="Theme">
      {["Auto","Light","Dark"].map(x =>
        <button key={x} className={m===x?"act":""} onClick={()=>{
          set(x);
          if (x === "Dark") document.documentElement.className = "dark";
          else if (x === "Light") document.documentElement.className = "light";
          else document.documentElement.className = (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        }}>{x}</button>
      )}
    </div>
  );
}

function NotificationBell() {
  const [unread, set] = useState(true);
  return (
    <button className={`bell${unread?" unread":""}`} onClick={()=>set(!unread)} title="Notifications">
      🔔{unread && <span className="dot">3</span>}
    </button>
  );
}

function FileTreeRow({ depth = 0, type, name, sel, dirty, exp, onClick }) {
  return (
    <div className={`tRow${sel?" sel":""}${type==="fld"?" fld":""}`} style={{marginLeft: depth*14}} onClick={onClick}>
      <span className={`chev${exp?" exp":""}`}>{type==="fld"?"▸":"·"}</span>
      <span>{name}</span>
      {dirty && <span className="dirty" title="Unsaved changes">●</span>}
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sbHead">
        <div className="sbPath" title="C:\\Declercq Cortex\\vault">~/vault</div>
        <button className="changeBtn" title="Choose another vault folder">Change…</button>
        <button className="iconBtn" title="Refresh file tree (Ctrl+R)">↻</button>
        <button className="iconBtn" title="Collapse sidebar">◀</button>
      </div>
      <div className="sbActions">
        <button className="changeBtn" title="New note (Ctrl+N)">+ Note</button>
        <button className="changeBtn" title="New idea (Ctrl+Shift+I)">+ Idea</button>
        <button className="changeBtn" title="New method">+ Method</button>
        <button className="changeBtn" title="New project">+ Proj</button>
        <button className="changeBtn" title="New experiment (Ctrl+Shift+E)">+ Exp</button>
        <button className="changeBtn" title="New iteration">+ Iter</button>
        <button className="changeBtn" title="Insert experiment block (Ctrl+Shift+B)">+ Block</button>
        <button className="changeBtn" title="Open today's daily log (Ctrl+D)">Today</button>
        <button className="changeBtn" title="Calendar — planned vs actual">Cal</button>
        <button className="changeBtn" title="Time tracking">⏱ Time</button>
        <button className="changeBtn" title="Methods Arsenal">Methods</button>
        <button className="changeBtn" title="Protocols Log">Protocols</button>
        <button className="changeBtn" title="Reviews">Reviews</button>
        <button className="changeBtn" title="Templates">Templates</button>
        <button className="changeBtn" title="Integrations (GitHub, Calendar)">GH</button>
      </div>
      <div className="sbTree">
        <FileTreeRow type="fld" name="01-Concept Inbox" exp/>
        <FileTreeRow depth={1} name="2026-05-08 — primer redesign.md"/>
        <FileTreeRow depth={1} name="2026-05-09 — anti-hype list.md"/>

        <FileTreeRow type="fld" name="02-Daily Log" exp/>
        <FileTreeRow depth={1} name="2026-05-10.md" sel dirty/>
        <FileTreeRow depth={1} name="2026-05-09.md"/>
        <FileTreeRow depth={1} name="2026-05-08.md"/>

        <FileTreeRow type="fld" name="05-Methods"/>
        <FileTreeRow type="fld" name="06-Protocols"/>
        <FileTreeRow type="fld" name="07-Experiments" exp/>
        <FileTreeRow depth={1} name="exp-014 — yield optimization.md"/>
        <FileTreeRow depth={1} type="fld" name="exp-014 / iter"/>
        <FileTreeRow type="fld" name="08-Reviews"/>
        <FileTreeRow type="fld" name="09-Reading"/>
      </div>
    </aside>
  );
}

function StatusBar() {
  return (
    <div className="statusBar">
      <span className="ok">●</span><span>Indexed 27 notes · vault healthy</span>
      <span style={{marginLeft:"auto"}}>~/vault/02-Daily Log/2026-05-10.md</span>
      <span>· Inter 15 · zoom 1.0×</span>
    </div>
  );
}

Object.assign(window, { EditorToolbar, Sidebar, StatusBar, NotificationBell, ThemeToggle, FileTreeRow });
