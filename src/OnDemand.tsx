// The pieces of the two on-demand tools that the page draws: on Functional
// isolation the "Draw a hazard" card, the "Your areas" list, the naming
// dialog and the messages on the map while drawing and running; on Pinch
// points the alternate routes tool inside a clicked road's popup. The
// approved mockups are the spec for all of it. No orange and no red anywhere:
// the user ruled both out. Green is the drawing tool's color.
import React, { useEffect, useRef, useState } from "react";
import {
  Box, Button, ButtonBase, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link,
  MenuItem, Select, Stack, Switch, TextField, Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ShareIcon from "@mui/icons-material/Share";
import EditIcon from "@mui/icons-material/Edit";
import DownloadIcon from "@mui/icons-material/Download";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import { BULLDOG_BLUE, NIGHT_SKY } from "./brand";
import { splitNames } from "./config";
import type { RouteBoxCtx } from "./MapView";
import {
  ApiError, ApiTarget, DrawCheck, FiLimits, MAX_ACROSS_MI, MAX_SQ_MI, ROUTE_COLORS, ROUTE_INKS, ROUTE_KEEP_DAYS,
  RouteLimits, RouteResult, SavedArea, SavedRoute, TARGET_SWITCHABLE, api, checkLocal, copyText, downloadText,
  fileSlug, forgetCode, hasRememberedCode, expiryWords, rememberCode, rememberedCode, routesApi, routesCsv, shareIdFor,
  setApiTarget, shareLink, timeLeft, useApiTarget,
} from "./ondemandApi";

// ------------------------------------------------------------ where the work goes

// Only on the dev server at localhost: whether the two tools send their work
// to the copy on this computer or to AWS. One setting for both tools. When
// the local copy does not answer, "This computer" is grayed out and a link
// opens the setup note (docs/local-setup.md). A production build never shows
// it: import.meta.env.DEV is false there and the whole body is dropped.
export function TargetSwitch({ onSetup }: { onSetup?: () => void }) {
  const { target, localUp } = useApiTarget();
  useEffect(() => { checkLocal(); }, []);
  if (!import.meta.env.DEV || !TARGET_SWITCHABLE) return null;
  const note = { fontSize: 12, color: "#57606a", lineHeight: 1.4, mt: 0.5 };
  return (
    <Box sx={{ mt: 1.25 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#3a434d", mb: 0.5 }}>Send the work to</Typography>
      {/* A switch (the user asked for a toggle switch): off is this
          computer, on is AWS. With no local copy running it stays on AWS
          and cannot be moved. */}
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Typography component="span" sx={{ fontSize: 12.5, fontWeight: target === "local" ? 800 : 500,
          color: localUp === false ? "#9aa3ad" : NIGHT_SKY }}>This computer</Typography>
        <Switch checked={target === "aws"} disabled={localUp === false}
          onChange={(e) => setApiTarget(e.target.checked ? "aws" : "local")}
          inputProps={{ "aria-label": "Send the work to AWS instead of this computer" }}
          sx={{
            "& .MuiSwitch-switchBase.Mui-checked": { color: NIGHT_SKY },
            "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": { bgcolor: BULLDOG_BLUE, opacity: 0.6 },
          }} />
        <Typography component="span" sx={{ fontSize: 12.5, fontWeight: target === "aws" ? 800 : 500, color: NIGHT_SKY }}>
          AWS (live)
        </Typography>
      </Stack>
      {target === "aws" && <Typography sx={note}>AWS uses the real daily limits.</Typography>}
      {localUp === false && (
        <Typography sx={note}>
          The copy on this computer is not running.{" "}
          <Link component="button" underline="hover" onClick={onSetup}
            sx={{ fontSize: 12, color: BULLDOG_BLUE, verticalAlign: "baseline" }}>
            How to set it up
          </Link>
        </Typography>
      )}
    </Box>
  );
}

// The drawing tool's green (the mockups' bold button), and a darker one for
// text on white.
export const DRAW_BUTTON = "#0B7A55";
export const DRAW_INK = "#075C40";
// The live size on the dark cursor note: green within the limits, violet
// (never red) over them.
const TIP_OK = "#6ee7a8";
const TIP_OVER = "#d9b8ff";

// -------------------------------------------------------- Functional isolation

export function DrawCard({ drawing, limits, limitsFailed, onStart, onCancel, onSetup }: {
  drawing: boolean; limits: FiLimits | null; limitsFailed: boolean;
  onStart: () => void; onCancel: () => void;
  // opens the note on running the tools on this computer (dev server only)
  onSetup?: () => void;
}) {
  const off = limits?.turned_off === true;
  const none = limits != null && (off || limits.runs_left <= 0);
  return (
    <Box sx={{
      border: `2px solid ${DRAW_BUTTON}`, borderRadius: 1.5, px: 2, py: 1.5, bgcolor: "#fff", mt: 2,
    }}>
      {drawing ? (
        <Button fullWidth onClick={onCancel} sx={{
          height: 44, borderRadius: 2, fontSize: 16, fontWeight: 800, letterSpacing: "0.02em", textTransform: "none",
          color: DRAW_INK, bgcolor: "#fff", border: `2px solid ${DRAW_BUTTON}`, "&:hover": { bgcolor: "#eef8f3" },
        }}>
          Cancel drawing
        </Button>
      ) : (
        <Button fullWidth disabled={none} onClick={onStart} startIcon={<EditIcon />} sx={{
          height: 44, borderRadius: 2, fontSize: 16, fontWeight: 800, letterSpacing: "0.02em", textTransform: "none",
          color: "#fff", bgcolor: DRAW_BUTTON, "&:hover": { bgcolor: DRAW_INK },
          "&.Mui-disabled": { bgcolor: "#c9d3cf", color: "#fff" },
        }}>
          Draw a hazard
        </Button>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, lineHeight: 1.45, fontSize: 12.5 }}>
        {drawing
          ? "Click each corner of the area. Double-click to finish. Press Backspace to undo a corner."
          : "Draw any area in North Carolina. See which roads it cuts off within a 10 minute drive."}
      </Typography>
      {!drawing && limits && (
        <Typography sx={{ mt: 0.75, fontSize: 12.5, fontWeight: 700, color: DRAW_INK }}>
          {off ? "The drawing tool is turned off for now."
            : none ? "No runs left today. More are available tomorrow."
            : `${limits.runs_left.toLocaleString()} of ${limits.runs_limit.toLocaleString()} runs left today`}
        </Typography>
      )}
      {!drawing && !limits && limitsFailed && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
          The drawing tool could not be reached just now.
        </Typography>
      )}
      {!drawing && TARGET_SWITCHABLE && <TargetSwitch onSetup={onSetup} />}
    </Box>
  );
}

// A small X that takes one of the reader's own entries out of this browser's
// list at once. Gray, never red or orange. It stops the click there, so the
// list does not also open the entry.
export function RemoveButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <IconButton size="small" aria-label={`Remove ${name}`} title={`Remove ${name}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(); }}
      sx={{ flexShrink: 0, color: "#57606a", p: 0.5, "&:hover": { bgcolor: "#e6e9ee", color: NIGHT_SKY } }}>
      <CloseIcon sx={{ fontSize: 18 }} />
    </IconButton>
  );
}

// ------------------------------------------------------------ sharing

// The link in a small box, already selected, for when the browser will not
// let the page copy it. Ctrl+C or Cmd+C copies it from there.
function ManualLink({ url, onClose, sx }: { url: string; onClose: () => void; sx?: object }) {
  return (
    <Box role="dialog" aria-label="Copy this link" sx={{
      bgcolor: "#fff", border: `1.5px solid ${BULLDOG_BLUE}`, borderRadius: 1.5, p: 1, width: 300, maxWidth: "80vw",
      boxShadow: "0 4px 14px rgba(0,20,45,0.18)", ...sx,
    }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: NIGHT_SKY }}>Copy this link</Typography>
        <RemoveButton name="this box" onRemove={onClose} />
      </Stack>
      <Box component="input" type="text" readOnly value={url} autoFocus
        ref={(el: HTMLInputElement | null) => { if (el) { el.focus(); el.select(); } }}
        onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.select()}
        sx={{ width: "100%", boxSizing: "border-box", font: "400 12.5px Figtree, Helvetica, Arial, sans-serif",
          border: "1px solid #b8c0ca", borderRadius: 1, px: 0.75, py: 0.5 }} />
    </Box>
  );
}

// Copies a link to the clipboard and says "Link copied" for a moment; when
// the browser refuses, shows the link selected in a small box instead, above
// or below the button. Bulldog Blue outline. It copies a link that reopens
// the results in the viewer, nothing to do with downloading, so it is kept
// away from the Download button (the user asked for that): at the top of
// the routes popup, and at the end of a drawn area's stats strip.
const OUTLINE_SX = {
  textTransform: "none", fontWeight: 700, color: BULLDOG_BLUE, borderColor: BULLDOG_BLUE, bgcolor: "#fff",
  "&:hover": { borderColor: NIGHT_SKY, bgcolor: "#eef2f9" },
} as const;
export function ShareButton({ link, label = "Share", title, small = false, below = false, sx }: {
  link: () => string | Promise<string>; label?: string; title?: string; small?: boolean; below?: boolean; sx?: object;
}) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const go = async () => {
    let url: string;
    setProblem(null);
    try { url = await link(); }
    catch (e) { setProblem(e instanceof Error && e.message ? e.message : "A link could not be made. Try again."); return; }
    if (await copyText(url)) {
      setManual(null);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2500);
    } else {
      setManual(url);
    }
  };
  return (
    <Box sx={{ position: "relative", display: "inline-flex", flexShrink: 0, ...sx }}>
      <Button variant="outlined" size={small ? "small" : "medium"} title={title} aria-label={title}
        startIcon={copied ? <CheckIcon /> : <ShareIcon />} onClick={go}
        aria-live="polite" sx={{ ...OUTLINE_SX, whiteSpace: "nowrap", flex: 1,
          ...(small ? { py: 0.25, px: 1, minWidth: 0, fontSize: 12.5, "& .MuiButton-startIcon": { mr: 0.5 },
            "& .MuiSvgIcon-root": { fontSize: 16 } } : {}) }}>
        {copied ? "Link copied" : label}
      </Button>
      {problem && (
        <Typography role="status" sx={{ position: "absolute", top: "100%", right: 0, mt: 0.5, zIndex: 3, width: 240,
          fontSize: 12, fontWeight: 700, bgcolor: "#fff", border: "1px solid #d5dae1", borderRadius: 1, p: 0.75 }}>
          {problem}
        </Typography>
      )}
      {manual && (
        <ManualLink url={manual} onClose={() => setManual(null)}
          sx={{ position: "absolute", right: 0, zIndex: 10,
            ...(below ? { top: "calc(100% + 6px)" } : { bottom: "calc(100% + 6px)" }) }} />
      )}
    </Box>
  );
}

// ------------------------------------------------------------ the two lists

// One entry in "Your areas" or "Your routes".
export interface ListEntry {
  id: string; name: string;
  line: string;                    // "Expires Nov 26 · 6 days 23 hours left", or "Running..."
  when: number;                    // newest first
  shown: boolean;                  // the one on the map now
  // its shared link (a set saved before sharing existed gets one by asking
  // the server for the routes again), or null when it has none
  link: (() => string | Promise<string>) | null;
}

// "Your areas" and "Your routes" are one card, so the two look and behave
// exactly alike (the user asked for that): a title, a closed list that says
// how many there are, and an open list where each row has the name, the
// expiry or "Running...", a share icon and the X. The one on the map has a
// check and a bold name. A pick is not held, so the closed list keeps its
// count and the same entry can be picked again.
// The share icon in a list row, and what it says after a click: "Link to
// "name" copied." under the list for a moment, or, when the browser refuses
// the clipboard, the link selected in a small box. Used by both saved lists
// and by the area rows in the "Choose a hazard" pulldown, so all three act
// the same.
export function useShareNote() {
  const [note, setNote] = useState<{ name: string; url: string | null; error?: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const share = async (name: string, url: string) => {
    const ok = await copyText(url);
    setNote({ name, url: ok ? null : url });
    window.clearTimeout(timer.current);
    if (ok) timer.current = window.setTimeout(() => setNote(null), 3000);
  };
  const fail = (name: string, error: string) => { window.clearTimeout(timer.current); setNote({ name, url: null, error }); };
  return { note, share, fail, clear: () => setNote(null) };
}
export function ShareNote({ note, onClose }: {
  note: { name: string; url: string | null; error?: string } | null; onClose: () => void;
}) {
  if (!note) return null;
  if (note.error) return <Typography role="status" sx={{ mt: 0.75, fontSize: 12.5, fontWeight: 700 }}>{note.error}</Typography>;
  return note.url
    ? <ManualLink url={note.url} onClose={onClose} sx={{ mt: 0.75, width: "auto" }} />
    : (
      <Typography role="status" sx={{ mt: 0.75, fontSize: 12.5, fontWeight: 700, color: BULLDOG_BLUE }}>
        Link to "{note.name}" copied.
      </Typography>
    );
}
// A row's share icon. It stops the click there, so the list does not also
// pick the entry.
export function ShareIconButton({ name, onShare }: { name: string; onShare: () => void }) {
  return (
    <IconButton size="small" aria-label={`Copy a link to ${name}`} title="Copy a link to share"
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); onShare(); }}
      sx={{ flexShrink: 0, color: BULLDOG_BLUE, p: 0.5, "&:hover": { bgcolor: "#eef2f9", color: NIGHT_SKY } }}>
      <ShareIcon sx={{ fontSize: 18 }} />
    </IconButton>
  );
}
// A saved area's line: "Running...", or its expiry date and countdown.
export const areaLine = (a: SavedArea, now: number) =>
  a.status === "failed" ? `Did not finish. ${expiryWords(a.expires_at, now)}`
    : a.status === "running" ? "Running..." : expiryWords(a.expires_at, now);
// A drawn area's link, without the map's position: the map may be somewhere
// else, and the link then goes to the area. A failed run has none.
export const areaLink = (a: SavedArea) =>
  a.status === "failed" ? null : () => shareLink({ tab: "isolation", run: a.run_id }, false);

function SavedListCard({ title, entries, one, many, unit, onPick, onRemove }: {
  title: string; entries: ListEntry[]; one: string; many: string; unit: string;
  onPick: (id: string) => void; onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { note, share: copyNote, fail, clear } = useShareNote();
  if (!entries.length) return null;
  const share = async (e: ListEntry) => {
    if (!e.link) return;
    setOpen(false);
    try { copyNote(e.name, await e.link()); }
    catch (err) { fail(e.name, err instanceof Error && err.message ? err.message : "A link could not be made. Try again."); }
  };
  return (
    <Box sx={{ border: "1px solid #ddd", borderRadius: 1.5, px: 2, py: 1.5, bgcolor: "#fff", mt: 2 }}>
      <Typography variant="subtitle2" gutterBottom>{title}</Typography>
      <Select fullWidth size="small" value="" displayEmpty open={open}
        onOpen={() => setOpen(true)} onClose={() => setOpen(false)}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        renderValue={() => (
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {entries.length === 1 ? `1 saved ${one}. Pick it to show it.` : `${entries.length} saved ${many}. Pick one to show it.`}
          </Typography>
        )}>
        {[...entries].sort((a, b) => b.when - a.when).map((e) => (
          <MenuItem key={e.id} value={e.id} sx={{ py: 0.5 }} aria-current={e.shown ? "true" : undefined}>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ width: "100%", minWidth: 0 }}>
              <Box sx={{ width: 18, flexShrink: 0, display: "flex" }} title={e.shown ? "On the map now" : undefined}>
                {e.shown && <CheckIcon sx={{ fontSize: 18, color: BULLDOG_BLUE }} aria-label="On the map now" />}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: e.shown ? 700 : 400 }}>{e.name}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{e.line}</Typography>
              </Box>
              {e.link && <ShareIconButton name={e.name} onShare={() => share(e)} />}
              <RemoveButton name={e.name} onRemove={() => onRemove(e.id)} />
            </Stack>
          </MenuItem>
        ))}
      </Select>
      <ShareNote note={note} onClose={clear} />
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
        Kept in this browser for {ROUTE_KEEP_DAYS} days. Opening one again uses none of today's {unit}.
        The share icon copies a link to it, and the X removes it.
      </Typography>
    </Box>
  );
}

export function AreasCard({ areas, activeId, now, onPick, onRemove }: {
  areas: SavedArea[]; activeId: string | null; now: number; onPick: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const t = Math.max(now, Date.now());
  return (
    <SavedListCard title="Your areas" one="area" many="areas" unit="runs" onPick={onPick} onRemove={onRemove}
      entries={areas.map((a) => ({
        id: a.run_id, name: a.name, line: areaLine(a, t), when: Date.parse(a.created_at),
        shown: a.run_id === activeId, link: areaLink(a),
      }))} />
  );
}

// The sets of alternate routes saved in this browser, on Pinch points.
// Picking one opens it on the map without calling the API. A set saved
// before the server kept routes has no route_id, and so no share icon.
export function RoutesCard({ routes, shownId, now, onPick, onRemove }: {
  routes: SavedRoute[]; shownId: string | null; now: number; onPick: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const t = Math.max(now, Date.now());
  return (
    <SavedListCard title="Your routes" one="set of routes" many="sets of routes" unit="route requests"
      onPick={onPick} onRemove={onRemove}
      entries={routes.map((r) => ({
        id: r.id, name: r.name, line: expiryWords(r.expires_at, t), when: Date.parse(r.saved_at),
        shown: r.id === shownId,
        // every set can be shared; one saved before the server kept routes
        // gets its id first (see shareIdFor)
        link: async () => shareLink({ tab: "pinch", route: await shareIdFor(r) }, false),
      }))} />
  );
}

// While drawing: the instructions and live size beside the cursor, and
// Finish and Cancel beside the last corner placed. The user found both too
// far away at the top of the map; buttons that followed the cursor itself
// could never be clicked, so they wait by the corner instead (above it and
// to its left, so the cursor's note, below and to the right, never covers
// them), moving with the map when it pans or zooms.
export function DrawHint({ check, corners, canFinish, onFinish, onCancel, anchor }: {
  check: DrawCheck | null; corners: number; canFinish: boolean; onFinish: () => void; onCancel: () => void;
  anchor: [number, number] | null;
}) {
  const small = { font: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer", px: 1.5, py: 0.5,
    borderRadius: 999, border: "1.5px solid #fff" } as const;
  const sqOver = check ? check.sqMi > MAX_SQ_MI : false;
  const acrossOver = check ? check.acrossMi > MAX_ACROSS_MI : false;
  const right = anchor ? anchor[0] < 260 : false;     // too near the left edge: go right of it
  const below = anchor ? anchor[1] < 64 : false;      // too near the top: go below it
  return (
    <>
      {anchor && (
      <Box sx={{
        position: "absolute", zIndex: 7,
        left: anchor[0] + (right ? 14 : -14), top: anchor[1] + (below ? 14 : -14),
        transform: `translate(${right ? "0" : "-100%"}, ${below ? "0" : "-100%"})`,
        bgcolor: "rgba(20,22,26,0.92)", color: "#fff", borderRadius: 2, px: 1.25, py: 0.75,
        display: "flex", alignItems: "center", gap: 1, fontSize: 13, whiteSpace: "nowrap",
        boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
      }}>
        <Box component="button" type="button" onClick={onFinish}
          disabled={!canFinish}
          sx={{ ...small, color: "#0b1a14", bgcolor: "#2ECC8C", borderColor: "#2ECC8C",
            "&:disabled": { opacity: 0.45, cursor: "default" } }}>
          Finish
        </Box>
        <Box component="button" type="button" onClick={onCancel}
          sx={{ ...small, color: "#fff", bgcolor: "transparent", "&:hover": { bgcolor: "rgba(255,255,255,0.15)" } }}>
          Cancel
        </Box>
      </Box>
      )}
      {/* The instructions and the live size ride beside the cursor, below
          and to its right, flipping to the other side near the map's edges.
          The user asked for the message to stay close to the cursor. */}
      <CursorTip>
        <Box sx={{ fontWeight: 600 }}>
          {corners === 0 ? "Click to add the first corner. Esc cancels."
            : corners < 3 ? "Click to add a corner." : "Click to add a corner. Double-click to finish."}
        </Box>
        {check && corners >= 2 && (
          <Box sx={{ fontVariantNumeric: "tabular-nums", mt: 0.25 }}>
            <span style={{ color: sqOver ? TIP_OVER : TIP_OK }}>{check.sqMi.toFixed(1)} of {MAX_SQ_MI} sq mi</span>
            {" · "}
            <span style={{ color: acrossOver ? TIP_OVER : TIP_OK }}>{check.acrossMi.toFixed(1)} of {MAX_ACROSS_MI} mi across</span>
          </Box>
        )}
        {check?.problem && corners >= 3 && (
          <Box sx={{ color: "#fff", fontWeight: 700, mt: 0.25 }}>{check.problem}</Box>
        )}
      </CursorTip>
    </>
  );
}

// A small box that follows the mouse over the map it sits in. It moves by
// setting its own transform (no re-render per mouse move), never takes a
// click (pointer-events none), and hides when the mouse leaves the map.
function CursorTip({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const GAP = 18;
    const move = (e: MouseEvent) => {
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const w = el.offsetWidth, h = el.offsetHeight;
      const left = x + GAP + w > r.width - 8 ? x - GAP - w : x + GAP;
      const top = y + GAP + h > r.height - 8 ? y - GAP - h : y + GAP;
      el.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`;
      el.style.visibility = "visible";
    };
    const hide = () => { el.style.visibility = "hidden"; };
    host.addEventListener("mousemove", move);
    host.addEventListener("mouseleave", hide);
    return () => {
      host.removeEventListener("mousemove", move);
      host.removeEventListener("mouseleave", hide);
    };
  }, []);
  return (
    <Box ref={ref} sx={{
      // dark with a white rim: reads on the light basemaps, and the rim
      // keeps it apart from the dark ones (the user asked for both)
      position: "absolute", left: 0, top: 0, zIndex: 7, pointerEvents: "none", visibility: "hidden",
      bgcolor: "#1d2025", color: "#fff", border: "2px solid #fff", borderRadius: 1.5, px: 1.25, py: 0.6,
      boxShadow: "0 2px 8px rgba(0,0,0,0.35)", fontSize: 12.5, lineHeight: 1.4, maxWidth: 300,
      whiteSpace: "nowrap",
    }}>
      {children}
    </Box>
  );
}

export function NameDialog({ open, onCancel, onSubmit }: {
  open: boolean; onCancel: () => void; onSubmit: (name: string, code: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // Set before the request goes out, so a second Enter while it is on its
  // way (state is not updated in time) cannot start a second run.
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setName(""); setCode(rememberedCode()); setError(null); setBusy(false); sending.current = false; }
  }, [open]);
  const go = async () => {
    if (sending.current) return;
    if (!name.trim()) { setError("Give the area a name."); return; }
    if (!code.trim()) { setError("Enter the access code."); return; }
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name.trim(), code.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
      sending.current = false;
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} maxWidth="xs" fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 700, pb: 0.5 }}>Name this area</DialogTitle>
      <DialogContent>
        <Box component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); go(); }}>
          <TextField autoFocus fullWidth margin="dense" size="small" label="Name" value={name} disabled={busy}
            inputProps={{ maxLength: 60 }} onChange={(e) => setName(e.target.value)} />
          <TextField fullWidth margin="dense" size="small" label="Access code" type="password" value={code}
            disabled={busy} autoComplete="off" onChange={(e) => setCode(e.target.value)} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Results are kept for 7 days, then removed.
          </Typography>
          {error && (
            <Typography variant="body2" role="alert" sx={{ mt: 1, fontWeight: 700, color: NIGHT_SKY }}>{error}</Typography>
          )}
          <button type="submit" hidden />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={busy} sx={{ textTransform: "none", fontWeight: 700, color: "#333a44" }}>
          Cancel
        </Button>
        <Button onClick={go} disabled={busy} variant="contained" disableElevation sx={{
          textTransform: "none", fontWeight: 700, bgcolor: DRAW_BUTTON, "&:hover": { bgcolor: DRAW_INK },
        }}>
          {busy ? "Starting..." : "Run it"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// The strip along the top of the map where the dark bars sit, between the
// legend at the left and the zoom buttons at the right, so neither is covered.
function TopSlot({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{
      position: "absolute", top: 12, left: "min(320px, 30%)", right: 56, zIndex: 6,
      display: "flex", justifyContent: "center", pointerEvents: "none",
      "& > *": { pointerEvents: "auto" },
    }}>
      {children}
    </Box>
  );
}

// A small turning ring, as in the mockups.
function Spinner() {
  return (
    <Box aria-hidden="true" sx={{
      width: 16, height: 16, borderRadius: "50%", border: "3px solid #fff", borderTopColor: "transparent",
      flexShrink: 0, boxSizing: "border-box", animation: "odSpin 0.9s linear infinite",
      "@keyframes odSpin": { to: { transform: "rotate(360deg)" } },
      "@media (prefers-reduced-motion: reduce)": { animation: "odSpin 2.5s linear infinite" },
    }} />
  );
}

// A dark bar across the top of the map: a run in progress, or a short notice.
export function MapBar({ children, spinner, onClose }: {
  children: React.ReactNode; spinner?: boolean; onClose?: () => void;
}) {
  return (
    <TopSlot>
    <Box role="status" sx={{
      bgcolor: "rgba(20,22,26,0.92)", color: "#fff", borderRadius: 2, pl: 1.75, pr: onClose ? 0.75 : 1.75, py: 0.9,
      display: "flex", alignItems: "center", gap: 1.25, fontSize: 13.5, maxWidth: 640,
      boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
    }}>
      {spinner && <Spinner />}
      <Box sx={{ lineHeight: 1.4 }}>{children}</Box>
      {onClose && (
        <Box component="button" type="button" onClick={onClose} aria-label="Close" sx={{
          width: 26, height: 26, p: 0, border: "none", borderRadius: 999, bgcolor: "transparent", cursor: "pointer",
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          "&:hover": { bgcolor: "rgba(255,255,255,0.15)" },
        }}>
          {/* an X drawn as an SVG, since Figtree has no glyph for it */}
          <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{
            width: 16, height: 16, fill: "none", stroke: "#fff", strokeWidth: 2.4, strokeLinecap: "round",
          }}>
            <path d="M6 6l12 12M18 6L6 18" />
          </Box>
        </Box>
      )}
    </Box>
    </TopSlot>
  );
}

// -------------------------------------------------------- Pinch points

// The day's route limit, read once a minute at most and kept up to date from
// each answer, shared by every popup. `base` is the API it came from, so a
// switch of the dev server's toggle reads the other one's count.
let routeLimits: { data: RouteLimits; at: number; base: string } | null = null;

const LABEL_STYLE: Record<string, { bg: string; ink: string }> = {
  "Truck safe": { bg: "#dcf3e3", ink: "#135c2b" },
  "Not truck safe": { bg: "#e6e9ee", ink: "#333a44" },
  "Possibly truck safe": { bg: "#fff1c7", ink: "#6b4b00" },
};

const mins = (v: number) => `${v.toFixed(1)} min`;
const miles = (v: number) => `${v.toFixed(1)} mi`;

const drawRoutes = (ctx: RouteBoxCtx, res: RouteResult) =>
  ctx.show((res.routes ?? []).map((r, i) => ({
    geometry: r.geometry, color: ROUTE_COLORS[i % 3], ink: ROUTE_INKS[i % 3], n: i + 1,
  })));

const savedDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// The alternate routes tool, inside a clicked road's popup on Pinch points.
// It shows the road's usual numbers with the button under them, then, once
// the routes are back, the ways around in place of the numbers. A set reopened
// from "Your routes" (ctx.saved) starts on its saved routes and asks the API
// for nothing. `onSave` keeps a set in this browser for 7 days. A set opened
// from someone's shared link (ctx.saved.shared) shows the same way and can be
// saved into this browser's list too, keeping the original's expiry date.
export function RoutesBox({ ctx, onSave, removed = null, onGone, onShowing, onSetup }: {
  ctx: RouteBoxCtx; onSave?: (name: string, road: string, result: RouteResult) => string;
  // opens the note on running the tools on this computer (dev server only)
  onSetup?: () => void;
  // The saved set the reader just removed from "Your routes". When it is the
  // one on show here, the popup closes and `onGone` puts the map back.
  removed?: { id: string; n: number } | null; onGone?: () => void;
  // which saved set is on show here (null for none), so "Your routes" can mark it
  onShowing?: (id: string | null) => void;
}) {
  const [askCode, setAskCode] = useState(!hasRememberedCode("routes"));
  const [code, setCode] = useState("");
  const { target } = useApiTarget();
  const [limits, setLimits] = useState<RouteLimits | null>(
    routeLimits && routeLimits.base === routesApi() ? routeLimits.data : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouteResult | null>(ctx.saved?.result ?? null);
  const [open, setOpen] = useState<number | null>(null);
  // the route lit from either side: a row hovered here or a line on the map
  const [lit, setLit] = useState<number | null>(null);
  useEffect(() => ctx.onHighlight(setLit), [ctx]);
  const overtureId = String(ctx.props.overture_id ?? "");
  const named = splitNames(ctx.props.road_name).primary;
  // The name a set is saved under, and when it was saved (from the list, or
  // just now from the Save button).
  const [saveName, setSaveName] = useState(ctx.saved?.name ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(ctx.saved && !ctx.saved.shared ? ctx.saved.saved_at : null);
  // the saved set on show, until the reader goes back or asks afresh
  const [reopened, setReopened] = useState<SavedRoute | null>(ctx.saved);
  // a saved set's routes are drawn as soon as its popup opens
  useEffect(() => { if (ctx.saved) drawRoutes(ctx, ctx.saved.result); }, [ctx]);
  // the saved set on show here (reopened from the list, or just saved)
  const [savedId, setSavedId] = useState<string | null>(ctx.saved?.id ?? null);
  useEffect(() => {
    if (removed && savedId && removed.id === savedId) { ctx.close(); onGone?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removed?.n]);
  useEffect(() => {
    onShowing?.(savedId);
    return () => onShowing?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedId]);
  const save = (result: RouteResult) => {
    if (!onSave) return;
    setSavedId(onSave(saveName.trim() || road, road, result));
    setSavedAt(new Date().toISOString());
  };

  useEffect(() => {
    let live = true;
    const base = routesApi();
    if (routeLimits && routeLimits.base === base && Date.now() - routeLimits.at < 60_000) {
      setLimits(routeLimits.data);
      return;
    }
    setLimits(null);
    api<RouteLimits>(base, "/limits").then((d) => {
      routeLimits = { data: d, at: Date.now(), base };
      if (live) setLimits(d);
    }).catch(() => { /* the line is left off */ });
    return () => { live = false; };
  }, [target]);
  useEffect(() => { ctx.relayout(); }, [askCode, busy, error, result, open, limits, savedAt, target]);

  const road = named !== "Unnamed road" ? named : result?.segment?.name || "this road";

  // Set before the request goes out, so a second Enter while it is on its
  // way cannot spend a second route request.
  const asking = useRef(false);
  const ask = async () => {
    if (asking.current) return;
    const use = askCode ? code.trim() : rememberedCode("routes");
    if (!use) { setError("Enter the access code."); return; }
    asking.current = true;
    setBusy(true);
    setError(null);
    try {
      const base = routesApi();
      const res = await api<RouteResult>(base, "/routes",
        { code: use, overture_id: overtureId, lon: ctx.lngLat[0], lat: ctx.lngLat[1] });
      rememberCode(use, "routes");
      setAskCode(false);
      if (typeof res.routes_left === "number" && limits) {
        const next = { ...limits, routes_left: res.routes_left };
        routeLimits = { data: next, at: Date.now(), base };
        setLimits(next);
      }
      setResult(res);
      setSavedAt(null);
      setReopened(null);
      setSavedId(null);
      setSaveName(named !== "Unnamed road" ? named : res.segment?.name || "");
      drawRoutes(ctx, res);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "Something went wrong. Please try again.");
      if (err.status === 401) { forgetCode("routes"); setAskCode(true); setCode(""); }
      setError(err.message);
    } finally {
      setBusy(false);
      asking.current = false;
    }
  };

  const back = () => {
    setResult(null); setOpen(null); setSavedAt(null); setReopened(null); setSavedId(null); ctx.show([]);
  };

  if (result) {
    const ok = result.status === "ok" && result.routes.length > 0;
    // the server's id for these routes, for the Share button
    const routeId = reopened ? reopened.route_id : result.route_id;
    // when they expire: the server's date, or 7 days from now for a fresh
    // set it could not keep
    const until = (reopened ? reopened.expires_at : result.expires_at)
      ?? new Date(Date.now() + ROUTE_KEEP_DAYS * 86_400_000).toISOString();
    const keptUntil = new Date(until).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const anySafe = result.routes.some((r) => r.truck_label === "Truck safe");
    return (
      <Box sx={{ width: 360, maxWidth: "100%", maxHeight: "min(70vh, 600px)", overflowY: "auto", pr: 0.5,
        fontFamily: "Figtree, Helvetica, Arial, sans-serif" }}>
        {/* Share sits beside the title: it copies a link that reopens this
            popup and its routes, so it is kept apart from Download. Only for
            routes the server kept; a set saved before it did has no id, and
            no Share button. */}
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Typography sx={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3, pt: 0.25 }}>Ways around if {road} closes</Typography>
          {ok && (routeId || reopened) && (
            <ShareButton small below title="Copy a link to these routes"
              link={async () => shareLink({ tab: "pinch", route: routeId ?? await shareIdFor(reopened!) }, true)} />
          )}
        </Stack>
        {reopened && !reopened.shared && (
          <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.25 }}>
            Saved {savedDate(reopened.saved_at)} as "{reopened.name}", {timeLeft(reopened.expires_at)}.
          </Typography>
        )}
        {reopened?.shared && (
          <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.25 }}>
            From a shared link. Worked out {savedDate(reopened.saved_at)}, {timeLeft(reopened.expires_at)}.
          </Typography>
        )}
        {!ok && <Typography sx={{ fontSize: 12.5, mt: 0.75, lineHeight: 1.5 }}>{result.message}</Typography>}
        {ok && result.open_road && (
          <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.25 }}>
            With the road open: {mins(result.open_road.minutes)}, {miles(result.open_road.miles)}
          </Typography>
        )}
        {ok && result.segment?.direction_note && (
          <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.25 }}>{result.segment.direction_note}</Typography>
        )}
        {/* Fewer than three: said in bold above the routes, in pale yellow
            (never orange or red), with the reason kept under the routes. */}
        {ok && result.routes.length < 3 && (
          <Box role="note" sx={{ mt: 1, px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: "#fff1c7", color: "#6b4b00" }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, lineHeight: 1.4 }}>
              {result.routes.length === 1 ? "Only 1 way around was found." : `Only ${result.routes.length} ways around were found.`}
            </Typography>
          </Box>
        )}
        {ok && (
          <Stack spacing={1} sx={{ mt: 1 }}>
            {result.routes.map((r, i) => {
              const tag = LABEL_STYLE[r.truck_label] ?? LABEL_STYLE["Not truck safe"];
              const folded = open !== i;
              return (
                <Box key={i}
                  onMouseEnter={() => ctx.highlight(i + 1)} onMouseLeave={() => ctx.highlight(null)}
                  sx={{
                    border: "1px solid", borderColor: lit === i + 1 ? ROUTE_COLORS[i % 3] : "#d5dae1",
                    boxShadow: lit === i + 1 ? `0 0 0 2px ${ROUTE_COLORS[i % 3]}` : "none",
                    bgcolor: lit === i + 1 ? "#f4f7fb" : "transparent",
                    opacity: lit != null && lit !== i + 1 ? 0.6 : 1,
                    transition: "opacity 120ms, box-shadow 120ms",
                    borderRadius: 2, px: 1.25, py: 1,
                  }}>
                  <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                    <Box sx={{
                      width: 20, height: 20, borderRadius: "50%", bgcolor: ROUTE_COLORS[i % 3], color: ROUTE_INKS[i % 3],
                      fontSize: 11.5, fontWeight: 800, display: "inline-flex", alignItems: "center",
                      justifyContent: "center", flexShrink: 0,
                    }}>{i + 1}</Box>
                    <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
                      {r.extra_minutes > 0 || r.extra_miles > 0
                        ? `${mins(r.extra_minutes)} longer, ${miles(r.extra_miles)} farther`
                        : "No longer than the road itself"}
                    </Typography>
                    <Box component="span" sx={{
                      fontSize: 11, fontWeight: 700, borderRadius: 999, px: 1, py: 0.25, bgcolor: tag.bg, color: tag.ink,
                    }}>{r.truck_label}</Box>
                  </Stack>
                  {r.truck_reason && r.truck_label !== "Truck safe" && (
                    <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.5, lineHeight: 1.45 }}>{r.truck_reason}</Typography>
                  )}
                  <ButtonBase onClick={() => setOpen(folded ? i : null)} aria-expanded={!folded}
                    sx={{ mt: 0.5, fontSize: 12, fontWeight: 700, color: BULLDOG_BLUE, borderRadius: 1, px: 0.25 }}>
                    {folded ? "Show directions" : "Hide directions"}
                    {folded ? <KeyboardArrowDownIcon sx={{ fontSize: 18 }} /> : <KeyboardArrowUpIcon sx={{ fontSize: 18 }} />}
                  </ButtonBase>
                  {!folded && (
                    <>
                      <Box component="ol" sx={{ m: 0, mt: 0.5, pl: 2.5, fontSize: 12.5, lineHeight: 1.55 }}>
                        {r.steps.map((s, k) => <li key={k}>{s}</li>)}
                      </Box>
                      <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.5 }}>
                        The whole way around: {mins(r.minutes)}, {miles(r.miles)}.{r.note ? ` ${r.note}` : ""}
                      </Typography>
                    </>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
        {ok && !anySafe && result.truck_summary && (
          <Typography sx={{ fontSize: 12, mt: 1, lineHeight: 1.45 }}>{result.truck_summary}</Typography>
        )}
        {/* A limit the user wants stated on every result: bridge heights are
            not checked (not something the routing does). */}
        {ok && (
          <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.75, lineHeight: 1.45 }}>
            Truck safe does not check bridge heights. Look out for low bridges.
          </Typography>
        )}
        {ok && result.fewer_routes && (
          <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.75, lineHeight: 1.45 }}>{result.fewer_routes}</Typography>
        )}
        {ok && (
          <>
            <Button fullWidth variant="outlined" startIcon={<DownloadIcon />} sx={{ ...OUTLINE_SX, mt: 1.25 }}
              onClick={() => downloadText(
                `alternate_routes_${fileSlug(road)}_${new Date().toISOString().slice(0, 10)}.csv`,
                routesCsv(road, overtureId, result))}>
              Download routes (CSV)
            </Button>
            <Typography sx={{ fontSize: 11.5, color: "#57606a", mt: 0.5 }}>
              One row per step of each route, with the route's extra time and distance, the direction, and the step's miles.
            </Typography>
          </>
        )}
        {ok && onSave && (!reopened || reopened.shared) && (
          <Box sx={{ mt: 1.25, pt: 1, borderTop: "1px solid #e3e7ea" }}>
            {savedAt ? (
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: NIGHT_SKY }}>
                Saved as "{saveName.trim() || road}". It is in Your routes in the panel until {keptUntil}.
              </Typography>
            ) : (
              <>
                <Stack direction="row" spacing={1} alignItems="flex-end">
                  <Box component="label" sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.5,
                    fontSize: 12, fontWeight: 700 }}>
                    Name
                    <Box component="input" type="text" value={saveName} maxLength={60}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSaveName(e.target.value)}
                      onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === "Enter") save(result);
                      }}
                      sx={{ font: "400 14px Figtree, Helvetica, Arial, sans-serif", border: "1px solid #b8c0ca",
                        borderRadius: 1.5, px: 1.25, py: 0.75, minWidth: 0 }} />
                  </Box>
                  <Button variant="contained" disableElevation
                    onClick={() => save(result)}
                    sx={{ textTransform: "none", fontWeight: 700, bgcolor: BULLDOG_BLUE, "&:hover": { bgcolor: NIGHT_SKY },
                      height: 37, flexShrink: 0 }}>
                    Save
                  </Button>
                </Stack>
                <Typography sx={{ fontSize: 11.5, color: "#57606a", mt: 0.5 }}>
                  Optional. Keeps these routes in this browser until {keptUntil}, to open again without using a click.
                </Typography>
              </>
            )}
          </Box>
        )}
        <Link component="button" underline="hover" onClick={back}
          sx={{ mt: 1, fontSize: 12, color: BULLDOG_BLUE, display: "block" }}>
          Back to this road's numbers
        </Link>
      </Box>
    );
  }

  return (
    <Box sx={{ fontFamily: "Figtree, Helvetica, Arial, sans-serif" }}>
      <div dangerouslySetInnerHTML={{ __html: ctx.html }} />
      <Box sx={{ mt: 1.25, pt: 1, borderTop: "1px solid #e3e7ea", maxWidth: 360 }}>
        {askCode && (
          <Box component="label" sx={{ display: "flex", flexDirection: "column", gap: 0.5, fontSize: 12, fontWeight: 700 }}>
            Access code
            <Box component="input" type="password" value={code} autoComplete="off" disabled={busy}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") ask(); }}
              sx={{ font: "400 14px Figtree, Helvetica, Arial, sans-serif", border: "1px solid #b8c0ca",
                borderRadius: 1.5, px: 1.25, py: 0.9 }} />
          </Box>
        )}
        <Button fullWidth variant="contained" disableElevation disabled={busy || !overtureId || limits?.turned_off === true}
          onClick={ask} sx={{
          mt: askCode ? 1 : 0, textTransform: "none", fontWeight: 700, fontSize: 14, bgcolor: BULLDOG_BLUE,
          "&:hover": { bgcolor: NIGHT_SKY },
        }}>
          Get alternate and truck-safe routes
        </Button>
        {busy && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75 }}>
            <CircularProgress size={14} thickness={6} sx={{ color: BULLDOG_BLUE }} />
            <Typography sx={{ fontSize: 12.5 }}>Finding ways around...</Typography>
          </Stack>
        )}
        {error && <Typography role="alert" sx={{ fontSize: 12.5, fontWeight: 700, color: NIGHT_SKY, mt: 0.75 }}>{error}</Typography>}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
          <Typography sx={{ fontSize: 12, color: "#57606a" }}>
            {!limits ? "" : limits.turned_off ? "The routes tool is turned off for now."
              : `${limits.routes_left.toLocaleString()} of ${limits.routes_limit.toLocaleString()} left today`}
          </Typography>
          {!askCode && (
            <Link component="button" underline="hover" sx={{ fontSize: 12, color: BULLDOG_BLUE }}
              onClick={() => { setAskCode(true); setCode(""); }}>
              change code
            </Link>
          )}
        </Stack>
        {TARGET_SWITCHABLE && !busy && <TargetSwitch onSetup={onSetup} />}
      </Box>
    </Box>
  );
}
