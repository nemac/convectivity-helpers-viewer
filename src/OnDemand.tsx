// The pieces of the two on-demand tools that the page draws: on Functional
// isolation the "Draw a hazard" card, the "Your hazards" list, the naming
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
import { recolorSwatches, splitNames, type BasemapKey } from "./config";
import type { RouteBoxCtx } from "./MapView";
import { focusLater } from "./focus";
import { ReportLink, routesReport, useReportSource } from "./feedback";
import {
  ApiError, ApiTarget, CODE_REMEMBERED, CodeNeeded, DrawCheck, FiLimits, MAX_ACROSS_MI, MAX_SQ_MI,
  ROUTE_KEEP_DAYS, RouteLimits, RouteResult, SavedArea, SavedRoute, TARGET_SWITCHABLE, TOO_BIG, api,
  checkLocal, copyText, downloadText,
  fileSlug, forgetCode, hasRememberedCode, expiryWords, rememberCode, rememberedCode, routePalette, routesApi, routesCsv, shareIdFor,
  setApiTarget, shareLink, targetNow, timeLeft, useApiTarget,
} from "./ondemandApi";

// Hidden on screen but read out by screen readers.
export const VISUALLY_HIDDEN = {
  // "1px", not 1: MUI reads 1 as 100%, which made a window-sized box that
  // let the whole page scroll.
  position: "absolute", width: "1px", height: "1px", p: 0, m: "-1px", overflow: "hidden",
  clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
} as const;

// An error from one of the tools, in the same pale yellow box as the
// one-route warning (never orange or red).
export const ERROR_BOX_SX = {
  px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: "#fff1c7", color: "#6b4b00",
  fontSize: 13, fontWeight: 700, lineHeight: 1.4,
} as const;

// ------------------------------------------------------------ where the work goes

// Only on the dev server at localhost: whether the two tools send their work
// to the copy on this computer or to AWS. One setting for both tools, and
// "This computer" is the default. It is never grayed out and never moves to
// AWS by itself (the user asked that dev always use the local copy); when the
// local copy does not answer, a note says so, with a link to the setup note
// (docs/local-setup.md). A production build never shows it:
// import.meta.env.DEV is false there and the whole body is dropped.
export function TargetSwitch({ onSetup }: { onSetup?: () => void }) {
  const { target, localUp } = useApiTarget();
  useEffect(() => { checkLocal(); }, []);
  if (!import.meta.env.DEV || !TARGET_SWITCHABLE) return null;
  const note = { fontSize: 12, color: "#57606a", lineHeight: 1.4, mt: 0.5 };
  return (
    <Box sx={{ mt: 1.25 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#3a434d", mb: 0.5 }}>Send the work to</Typography>
      {/* A switch (the user asked for a toggle switch): off is this
          computer, on is AWS. Always movable. */}
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Typography component="span" sx={{ fontSize: 13, fontWeight: target === "local" ? 800 : 500,
          color: NIGHT_SKY }}>This computer</Typography>
        <Switch checked={target === "aws"}
          onChange={(e) => setApiTarget(e.target.checked ? "aws" : "local")}
          inputProps={{ "aria-label": "Send the work to AWS (live) instead of this computer" }}
          sx={{
            "& .MuiSwitch-switchBase.Mui-checked": { color: NIGHT_SKY },
            "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": { bgcolor: BULLDOG_BLUE, opacity: 0.6 },
          }} />
        <Typography component="span" sx={{ fontSize: 13, fontWeight: target === "aws" ? 800 : 500, color: NIGHT_SKY }}>
          AWS (live)
        </Typography>
      </Stack>
      {target === "aws" && <Typography sx={note}>AWS uses the real daily limits.</Typography>}
      {localUp === false && target === "local" && (
        <Typography sx={{ ...ERROR_BOX_SX, fontSize: 12, mt: 0.75 }}>
          The copy on this computer is not running, so this tool cannot run. Start Docker, then
          restart npm run dev:local.{" "}
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

// The guide's pulsing Bulldog Blue outline, as on the panel's other cards
// (Card in App.tsx).
export const litSx = (lit?: boolean) => (lit ? {
  borderColor: BULLDOG_BLUE,
  boxShadow: `0 0 0 3px ${BULLDOG_BLUE}`,
  animation: "guidePulse 1.8s ease-in-out infinite",
  "@keyframes guidePulse": {
    "0%, 100%": { boxShadow: `0 0 0 3px ${BULLDOG_BLUE}, 0 0 0 3px rgba(0,61,165,0.25)` },
    "50%": { boxShadow: `0 0 0 3px ${BULLDOG_BLUE}, 0 0 0 10px rgba(0,61,165,0.12)` },
  },
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} : {});

export function DrawCard({ drawing, limits, limitsFailed, onStart, onCancel, onSetup, lit = false, buttonRef }: {
  drawing: boolean; limits: FiLimits | null; limitsFailed: boolean;
  // the Draw a hazard (or Cancel drawing) button, for focus to come back to
  buttonRef?: React.Ref<HTMLButtonElement>;
  // the guide is pointing at this card
  lit?: boolean;
  onStart: () => void; onCancel: () => void;
  // opens the note on running the tools on this computer (dev server only)
  onSetup?: () => void;
}) {
  const off = limits?.turned_off === true;
  const none = limits != null && (off || limits.runs_left <= 0);
  return (
    <Box data-guide="draw" sx={{
      border: `2px solid ${DRAW_BUTTON}`, borderRadius: 1.5, px: 2, py: 1.5, bgcolor: "#fff", mt: 2,
      ...litSx(lit),
    }}>
      {drawing ? (
        <Button ref={buttonRef} fullWidth onClick={onCancel} sx={{
          height: 44, borderRadius: 2, fontSize: 16, fontWeight: 800, letterSpacing: "0.02em", textTransform: "none",
          color: DRAW_INK, bgcolor: "#fff", border: `2px solid ${DRAW_BUTTON}`, "&:hover": { bgcolor: "#eef8f3" },
        }}>
          Cancel drawing
        </Button>
      ) : (
        <Button ref={buttonRef} fullWidth disabled={none} onClick={onStart} startIcon={<EditIcon />} sx={{
          height: 44, borderRadius: 2, fontSize: 16, fontWeight: 800, letterSpacing: "0.02em", textTransform: "none",
          color: "#fff", bgcolor: DRAW_BUTTON, "&:hover": { bgcolor: DRAW_INK },
          "&.Mui-disabled": { bgcolor: "#c9d3cf", color: "#fff" },
        }}>
          Draw a hazard
        </Button>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, lineHeight: 1.45, fontSize: 12.5 }}>
        {drawing
          ? "Click each corner of the hazard. Double-click to finish. Press Backspace to undo a corner."
          : `Draw a flood, a closure or any other hazard in North Carolina, up to ${MAX_SQ_MI} square miles. `
            + "See which roads it cuts off within a 10-minute drive."}
      </Typography>
      {!drawing && limits && (
        <Typography sx={{ mt: 0.75, fontSize: 12.5, fontWeight: 700, color: DRAW_INK }}>
          {off ? (limits.cap_reached ? "Drawing is turned off until next month." : "Drawing is turned off for now.")
            : none ? "No more hazards can be drawn today. More are available after midnight, Eastern time."
            : `${limits.runs_left.toLocaleString()} of ${limits.runs_limit.toLocaleString()} hazards left to draw today`}
        </Typography>
      )}
      {!drawing && !limits && limitsFailed && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
          Drawing a hazard is not available just now. Try again later.
        </Typography>
      )}
      {!drawing && TARGET_SWITCHABLE && <TargetSwitch onSetup={onSetup} />}
    </Box>
  );
}

// A small X that takes one of the reader's own entries out of this browser's
// list at once. Gray, never red or orange. It stops the click there, so the
// list does not also open the entry.
// `inList` is for a row inside a pulldown's list (see RowIcon).
// `closes` marks an X that closes a box rather than removing an entry, so it
// keeps working in feedback mode like every other close X (its name, "Remove
// this box", is not one the feedback rule can tell from removing an entry).
export function RemoveButton({ name, onRemove, inList = false, closes = false }: {
  name: string; onRemove: () => void; inList?: boolean; closes?: boolean;
}) {
  if (inList) {
    return (
      <RowIcon title={`Remove ${name}`} color="#57606a" hover="#e6e9ee" onClick={onRemove}>
        <CloseIcon sx={{ fontSize: 18 }} />
      </RowIcon>
    );
  }
  return (
    <IconButton size="small" aria-label={`Remove ${name}`} title={`Remove ${name}`}
      {...(closes ? { "data-feedback-pass": "" } : {})}
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
    <Box role="dialog" aria-label="Copy this link"
      // Escape closes it, as it does the code box (and goes no further)
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); }
      }}
      sx={{
      bgcolor: "#fff", border: `1.5px solid ${BULLDOG_BLUE}`, borderRadius: 1.5, p: 1, width: 300, maxWidth: "80vw",
      boxShadow: "0 4px 14px rgba(0,20,45,0.18)", ...sx,
    }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: NIGHT_SKY }}>Copy this link</Typography>
        <RemoveButton name="this box" onRemove={onClose} closes />
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
// A small box asking for the access code, for sharing a set of routes saved
// before the server kept routes: making its link asks for the routes once
// more, which takes the code. The published site remembers no code, so it is
// asked for here, in that step.
function CodeAsk({ onSubmit, onCancel, sx }: {
  onSubmit: (code: string) => void; onCancel: () => void; sx?: object;
}) {
  const [code, setCode] = useState("");
  return (
    <Box component="form" role="dialog" aria-label="Access code to make the link"
      onSubmit={(e: React.FormEvent) => { e.preventDefault(); if (code.trim()) onSubmit(code.trim()); }}
      sx={{ bgcolor: "#fff", border: `1.5px solid ${BULLDOG_BLUE}`, borderRadius: 1.5, p: 1, width: 260,
        maxWidth: "80vw", boxSizing: "border-box", boxShadow: "0 4px 14px rgba(0,20,45,0.18)", ...sx }}>
      <Box component="label" sx={{ display: "flex", flexDirection: "column", gap: 0.5, fontSize: 12, fontWeight: 700,
        color: NIGHT_SKY }}>
        Access code, to make the link
        <Box component="input" type="password" value={code} autoComplete="off" autoFocus
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}
          sx={{ font: "400 14px Figtree, Helvetica, Arial, sans-serif", border: "1px solid #b8c0ca",
            borderRadius: 1.5, px: 1, py: 0.6, minWidth: 0 }} />
      </Box>
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 0.75 }}>
        <Button size="small" onClick={onCancel} sx={{ textTransform: "none", fontWeight: 700, color: "#333a44" }}>
          Cancel
        </Button>
        <Button size="small" type="submit" variant="contained" disableElevation disabled={!code.trim()}
          sx={{ textTransform: "none", fontWeight: 700, bgcolor: BULLDOG_BLUE, "&:hover": { bgcolor: NIGHT_SKY } }}>
          Make the link
        </Button>
      </Stack>
    </Box>
  );
}

export function ShareButton({ link, label = "Share", title, small = false, below = false, sx }: {
  link: (code?: string) => string | Promise<string>; label?: string; title?: string; small?: boolean;
  below?: boolean; sx?: object;
}) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [needCode, setNeedCode] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // closing the link box or the code box gives focus back to this button
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const back = () => focusLater(() => buttonRef.current);
  const go = async (code?: string) => {
    let url: string;
    setProblem(null);
    try { url = await link(code); }
    catch (e) {
      if (e instanceof CodeNeeded) { setNeedCode(true); return; }
      setProblem(e instanceof Error && e.message ? e.message : "A link could not be made. Try again.");
      return;
    }
    setNeedCode(false);
    if (await copyText(url)) {
      setManual(null);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2500);
    } else {
      setManual(url);
    }
  };
  const place = { position: "absolute", right: 0, zIndex: 10,
    ...(below ? { top: "calc(100% + 6px)" } : { bottom: "calc(100% + 6px)" }) };
  return (
    <Box sx={{ position: "relative", display: "inline-flex", flexShrink: 0, ...sx }}>
      {/* Named by its visible word, "Share"; the title says what it does. */}
      <Button ref={buttonRef} variant="outlined" size={small ? "small" : "medium"} title={title}
        startIcon={copied ? <CheckIcon /> : <ShareIcon />} onClick={() => go()}
        aria-live="polite" sx={{ ...OUTLINE_SX, whiteSpace: "nowrap", flex: 1,
          ...(small ? { py: 0.25, px: 1, minWidth: 0, fontSize: 13, "& .MuiButton-startIcon": { mr: 0.5 },
            "& .MuiSvgIcon-root": { fontSize: 16 } } : {}) }}>
        {copied ? "Link copied" : label}
      </Button>
      {problem && (
        <Box role="status" sx={{ ...ERROR_BOX_SX, position: "absolute", top: "100%", right: 0, mt: 0.5, zIndex: 3,
          width: 240, fontSize: 12 }}>
          {problem}
        </Box>
      )}
      {needCode && <CodeAsk onSubmit={(c) => go(c)} onCancel={() => { setNeedCode(false); back(); }} sx={place} />}
      {manual && <ManualLink url={manual} onClose={() => { setManual(null); back(); }} sx={place} />}
    </Box>
  );
}

// ------------------------------------------------------------ the two lists

// One entry in "Your hazards" or "Your alternate routes".
export interface ListEntry {
  id: string; name: string;
  line: string;                    // "Expires Nov 26 · 6 days 23 hours left", or "Running..."
  when: number;                    // newest first
  shown: boolean;                  // the one on the map now
  // its shared link (a set saved before sharing existed gets one by asking
  // the server for the routes again), or null when it has none
  // (`code` is the access code, when the reader was just asked for it)
  link: ((code?: string) => string | Promise<string>) | null;
}

// "Your hazards" and "Your alternate routes" are one card, so the two look and behave
// exactly alike (the user asked for that): a title, a closed list that says
// how many there are, and an open list where each row has the name, the
// expiry or "Running...", a share icon and the X. The one on the map has a
// check and a bold name. A pick is not held, so the closed list keeps its
// count and the same entry can be picked again.
// The share icon in a list row, and what it says after a click: "Link to
// "name" copied." under the list for a moment, or, when the browser refuses
// the clipboard, the link selected in a small box. Used by both saved lists
// and by the drawn hazards' rows in the "Choose a hazard" pulldown, so all three act
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
  if (note.error) return <Box role="status" sx={{ ...ERROR_BOX_SX, mt: 0.75 }}>{note.error}</Box>;
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
export function ShareIconButton({ name, onShare, inList = false }: {
  name: string; onShare: () => void; inList?: boolean;
}) {
  if (inList) {
    return (
      <RowIcon title={`Share ${name}`} color={BULLDOG_BLUE} hover="#eef2f9" onClick={onShare}>
        <ShareIcon sx={{ fontSize: 18 }} />
      </RowIcon>
    );
  }
  return (
    <IconButton size="small" aria-label={`Share ${name}`} title="Copy a link to share"
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); onShare(); }}
      sx={{ flexShrink: 0, color: BULLDOG_BLUE, p: 0.5, "&:hover": { bgcolor: "#eef2f9", color: NIGHT_SKY } }}>
      <ShareIcon sx={{ fontSize: 18 }} />
    </IconButton>
  );
}
// The share icon or X on a row inside a pulldown's list, for the mouse. A
// button inside a list option cannot be reached from the keyboard (Tab
// closes the list) and reads to a screen reader as part of the option, so
// this one is hidden from both. The same actions are real buttons beside the
// pulldown, for the entry picked or on the map.
function RowIcon({ title, color, hover, onClick, children }: {
  title: string; color: string; hover: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <Box component="span" aria-hidden="true" title={title}
      onMouseDown={(ev: React.MouseEvent) => ev.stopPropagation()}
      onClick={(ev: React.MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); onClick(); }}
      sx={{ flexShrink: 0, display: "inline-flex", p: 0.5, borderRadius: "50%", color, cursor: "pointer",
        transition: "background-color 150ms", "&:hover": { bgcolor: hover, color: NIGHT_SKY } }}>
      {children}
    </Box>
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
  // the entry whose link waits for the access code (see CodeAsk)
  const [askFor, setAskFor] = useState<ListEntry | null>(null);
  const titleId = `saved-list-${one.replace(/\W+/g, "-")}`;
  const boxRef = useRef<HTMLDivElement>(null);
  const toList = () => focusLater(() => boxRef.current?.querySelector<HTMLElement>('[role="combobox"]'));
  if (!entries.length) return null;
  // the entry on the map, whose share icon and X are also beside the list
  const shown = entries.find((e) => e.shown);
  const share = async (e: ListEntry, code?: string) => {
    if (!e.link) return;
    setOpen(false);
    try { copyNote(e.name, await e.link(code)); setAskFor(null); }
    catch (err) {
      if (err instanceof CodeNeeded) { clear(); setAskFor(e); return; }
      setAskFor(null);
      fail(e.name, err instanceof Error && err.message ? err.message : "A link could not be made. Try again.");
    }
  };
  return (
    <Box ref={boxRef} sx={{ border: "1px solid #ddd", borderRadius: 1.5, px: 2, py: 1.5, bgcolor: "#fff", mt: 2 }}>
      <Typography variant="subtitle2" component="h2" gutterBottom id={titleId}>{title}</Typography>
      <Stack direction="row" alignItems="center" spacing={0.5}>
      <Select fullWidth size="small" value="" displayEmpty open={open} labelId={titleId} sx={{ flex: 1, minWidth: 0 }}
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
              {e.link && <ShareIconButton inList name={e.name} onShare={() => share(e)} />}
              <RemoveButton inList name={e.name} onRemove={() => onRemove(e.id)} />
            </Stack>
          </MenuItem>
        ))}
      </Select>
      {shown?.link && <ShareIconButton name={shown.name} onShare={() => share(shown)} />}
      {shown && <RemoveButton name={shown.name} onRemove={() => { onRemove(shown.id); toList(); }} />}
      </Stack>
      {askFor && (
        <CodeAsk key={askFor.id} onSubmit={(c) => share(askFor, c)} onCancel={() => { setAskFor(null); toList(); }}
          sx={{ mt: 0.75, width: "auto" }} />
      )}
      <ShareNote note={note} onClose={() => { clear(); toList(); }} />
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
    <SavedListCard title="Your hazards" one="hazard" many="hazards" unit="hazards to draw" onPick={onPick} onRemove={onRemove}
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
    <SavedListCard title="Your alternate routes" one="set of routes" many="sets of routes" unit="route requests"
      onPick={onPick} onRemove={onRemove}
      entries={routes.map((r) => ({
        id: r.id, name: r.name, line: expiryWords(r.expires_at, t), when: Date.parse(r.saved_at),
        shown: r.id === shownId,
        // every set can be shared; one saved before the server kept routes
        // gets its id first (see shareIdFor)
        link: async (code?: string) => shareLink({ tab: "pinch", route: await shareIdFor(r, code) }, false),
      }))} />
  );
}

// While drawing: the instructions and live size beside the cursor, and
// Finish and Cancel beside the last corner placed. The user found both too
// far away at the top of the map; buttons that followed the cursor itself
// could never be clicked, so they wait by the corner instead (above it and
// to its left, so the cursor's note, below and to the right, never covers
// them), moving with the map when it pans or zooms.
export function DrawHint({ check, corners, canFinish, finishWhy = null, onFinish, onCancel, anchor }: {
  check: DrawCheck | null; corners: number; canFinish: boolean; onFinish: () => void; onCancel: () => void;
  // why Finish is grayed out, said beside it so it stays when the mouse
  // leaves the map and the cursor's note hides
  finishWhy?: string | null;
  anchor: [number, number] | null;
}) {
  const small = { font: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer", px: 1.5, py: 0.5,
    borderRadius: 999, border: "1.5px solid #fff" } as const;
  const sqOver = check ? check.sqMi > MAX_SQ_MI : false;
  const acrossOver = check ? check.acrossMi > MAX_ACROSS_MI : false;
  // too near the left edge: go right of it (the box is wider when it says
  // why Finish is grayed out)
  const right = anchor ? anchor[0] < (!canFinish && finishWhy ? 360 : 260) : false;
  const below = anchor ? anchor[1] < 64 : false;      // too near the top: go below it
  // "Too big" in words from the moment the size is over, not only in the
  // numbers' color; the other problems once there are three corners.
  const said = !check ? null
    : corners >= 3 && check.problem ? check.problem
    : check.tooBig ? TOO_BIG : null;
  return (
    <>
      {/* Drawing problems and why Finish is grayed out, read out by screen
          readers as they change. */}
      <Box role="status" aria-live="polite" sx={VISUALLY_HIDDEN}>
        {[said, !canFinish && corners > 0 && finishWhy !== said ? finishWhy : null].filter(Boolean).join(" ")}
      </Box>
      {anchor && (
      <Box className="on-dark" sx={{
        position: "absolute", zIndex: 7,
        left: anchor[0] + (right ? 14 : -14), top: anchor[1] + (below ? 14 : -14),
        transform: `translate(${right ? "0" : "-100%"}, ${below ? "0" : "-100%"})`,
        bgcolor: "rgba(20,22,26,0.92)", color: "#fff", borderRadius: 2, px: 1.25, py: 0.75,
        border: "2px solid #fff",
        display: "flex", alignItems: "center", gap: 1, fontSize: 13, whiteSpace: "nowrap",
        boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
      }}>
        <Box component="button" type="button" onClick={onFinish}
          disabled={!canFinish}
          sx={{ ...small, color: "#0b1a14", bgcolor: "#2ECC8C", borderColor: "#2ECC8C",
            "&:disabled": { opacity: 0.45, cursor: "default" } }}>
          Finish
        </Box>
        {!canFinish && finishWhy && (
          <Box component="span" sx={{ fontWeight: 700, color: TIP_OVER }}>{finishWhy}</Box>
        )}
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
          {corners === 0 ? "Click to add the first corner of your hazard. Esc cancels."
            : corners < 3 ? "Click to add a corner." : "Click to add a corner. Double-click to finish."}
        </Box>
        {check && (corners >= 2 || check.tooBig) && (
          <Box sx={{ fontVariantNumeric: "tabular-nums", mt: 0.25 }}>
            <span style={{ color: sqOver ? TIP_OVER : TIP_OK }}>{check.sqMi.toFixed(1)} of {MAX_SQ_MI} sq mi</span>
            {" · "}
            <span style={{ color: acrossOver ? TIP_OVER : TIP_OK }}>{check.acrossMi.toFixed(1)} of {MAX_ACROSS_MI} mi across</span>
          </Box>
        )}
        {said && (
          <Box sx={{ color: "#fff", fontWeight: 700, mt: 0.25 }}>{said}</Box>
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
      // as wide as its longest line up to 300 px; a longer line ("Too big...")
      // wraps inside the box rather than running out of it
      boxShadow: "0 2px 8px rgba(0,0,0,0.35)", fontSize: 12.5, lineHeight: 1.4, maxWidth: 300,
      width: "max-content", boxSizing: "border-box", whiteSpace: "normal", overflowWrap: "break-word",
    }}>
      {children}
    </Box>
  );
}

export function NameDialog({ open, onCancel, onSubmit, onClosed }: {
  open: boolean; onCancel: () => void; onSubmit: (name: string, code: string) => Promise<void>;
  // once it has closed: where keyboard focus goes next
  onClosed?: () => void;
}) {
  const nameRef = useRef<HTMLInputElement | null>(null);
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
    if (!name.trim()) { setError("Give the hazard a name."); return; }
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
    // Focus starts in the Name field and, once closed, goes where the page
    // says (the Draw a hazard button), not back to the map it came from.
    <Dialog open={open} onClose={busy ? undefined : onCancel} maxWidth="xs" fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }} disableRestoreFocus
      TransitionProps={{ onEntered: () => nameRef.current?.focus(), onExited: onClosed }}>
      <DialogTitle sx={{ fontWeight: 700, pb: 0.5 }}>Name this hazard</DialogTitle>
      <DialogContent>
        <Box component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); go(); }}>
          <TextField inputRef={nameRef} autoFocus fullWidth margin="dense" size="small" label="Name" value={name} disabled={busy}
            inputProps={{ maxLength: 60 }} onChange={(e) => setName(e.target.value)} />
          <TextField fullWidth margin="dense" size="small" label="Access code" type="password" value={code}
            disabled={busy} autoComplete="off" onChange={(e) => setCode(e.target.value)} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Results are kept for 7 days, then removed.
          </Typography>
          {error && (
            <Box role="alert" sx={{ ...ERROR_BOX_SX, mt: 1 }}>{error}</Box>
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
          {busy ? "Starting..." : "Find what it cuts off"}
        </Button>
      </DialogActions>
    </Dialog>
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

// A dark note on the map: a drawn hazard being worked out, or a short
// notice. MapView places it beside the drawn hazard's outline (or at the top
// of the map when there is none), clear of the legend and the popups.
export function MapBar({ children, spinner, onClose }: {
  children: React.ReactNode; spinner?: boolean; onClose?: () => void;
}) {
  return (
    <Box role="status" className="on-dark" sx={{
      // the same 2 px white rim as the cursor's note and the hazard's popup,
      // so the bar stands apart from the dark basemaps and the imagery
      bgcolor: "rgba(20,22,26,0.92)", color: "#fff", borderRadius: 2, pl: 1.75, pr: onClose ? 0.75 : 1.75, py: 0.9,
      border: "2px solid #fff",
      display: "flex", alignItems: "center", gap: 1.25, fontSize: 13.5, maxWidth: 380, boxSizing: "border-box",
      boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
    }}>
      {spinner && <Spinner />}
      <Box sx={{ lineHeight: 1.4 }}>{children}</Box>
      {onClose && (
        <Box component="button" type="button" onClick={onClose} aria-label="Close" title="Close" sx={{
          width: 28, height: 28, p: 0, border: "none", borderRadius: 999, bgcolor: "transparent", cursor: "pointer",
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
          "&:hover": { bgcolor: "rgba(255,255,255,0.15)" },
        }}>
          <CloseIcon aria-hidden="true" sx={{ fontSize: 18 }} />
        </Box>
      )}
    </Box>
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
    geometry: r.geometry, n: i + 1,   // the map picks the colors for its basemap
  })));

const savedDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// The alternate routes tool, inside a clicked road's popup on Pinch points.
// It shows the road's usual numbers with the button under them, then, once
// the routes are back, the alternate routes in place of the numbers. A set reopened
// from "Your alternate routes" (ctx.saved) starts on its saved routes and asks the API
// for nothing. `onSave` keeps a set in this browser for 7 days. A set opened
// from someone's shared link (ctx.saved.shared) shows the same way and can be
// saved into this browser's list too, keeping the original's expiry date.
export function RoutesBox({ ctx, basemap, onSave, removed = null, onGone, onShowing, onSetup }: {
  ctx: RouteBoxCtx; onSave?: (name: string, road: string, result: RouteResult) => string;
  // the chips and row borders match the route lines drawn on this basemap
  basemap: BasemapKey;
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
  const pal = routePalette(basemap);
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
  // Where and when the routes on show were worked out, for the copy a
  // "Something look wrong?" report carries. A reopened set was worked out
  // when it was saved, on the target in use now as far as this page knows.
  const [fetched, setFetched] = useState<{ at: string; target: ApiTarget }>(
    () => ({ at: ctx.saved?.result.created_at ?? ctx.saved?.saved_at ?? new Date().toISOString(), target: targetNow() }));
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
  // Where keyboard focus goes as the box changes under it: the routes'
  // title when they come back, the "Saved as" line after Save, and the Get
  // routes button after "Back to this road's numbers".
  const titleRef = useRef<HTMLElement | null>(null);
  const savedRef = useRef<HTMLElement | null>(null);
  const getRef = useRef<HTMLButtonElement | null>(null);
  const save = (result: RouteResult) => {
    if (!onSave) return;
    setSavedId(onSave(saveName.trim() || road, road, result));
    setSavedAt(new Date().toISOString());
    focusLater(() => savedRef.current);
  };
  // the swatch in the road's numbers (ctx.html) follows the basemap
  const htmlRef = useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => { recolorSwatches(htmlRef.current, basemap); }, [basemap, result]);

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
      const sentTo = targetNow();
      const res = await api<RouteResult>(base, "/routes",
        { code: use, overture_id: overtureId, lon: ctx.lngLat[0], lat: ctx.lngLat[1] });
      rememberCode(use, "routes");
      // On the published site the code is asked for every time, so the box
      // stays and is emptied; the dev server keeps it for the visit.
      if (CODE_REMEMBERED) setAskCode(false);
      else setCode("");
      if (typeof res.routes_left === "number" && limits) {
        const next = { ...limits, routes_left: res.routes_left };
        routeLimits = { data: next, at: Date.now(), base };
        setLimits(next);
      }
      setResult(res);
      setFetched({ at: res.created_at ?? new Date().toISOString(), target: sentTo });
      setSavedAt(null);
      setReopened(null);
      setSavedId(null);
      setSaveName(named !== "Unnamed road" ? named : res.segment?.name || "");
      drawRoutes(ctx, res);
      focusLater(() => titleRef.current);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "Something went wrong. Please try again.");
      if (err.status === 401) { forgetCode("routes"); setAskCode(true); setCode(""); }
      setError(err.message);
    } finally {
      setBusy(false);
      asking.current = false;
    }
  };

  // The routes on show, as a "Something look wrong?" report: from the link
  // under the title, or in feedback mode from a click on a route line.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const buildReport = () => (result ? routesReport({
    route_id: (reopened ? reopened.route_id : result.route_id) ?? undefined,
    overture_id: overtureId, road_name: road, lnglat: ctx.lngLat, target: fetched.target,
    fetched_at: fetched.at, expires_at: (reopened ? reopened.expires_at : result.expires_at) ?? undefined, result,
  }) : null);
  useReportSource("routes", ["alt-routes-line", "alt-routes-casing"], result ? buildReport : null);

  const back = () => {
    setResult(null); setOpen(null); setSavedAt(null); setReopened(null); setSavedId(null); ctx.show([]);
    focusLater(() => getRef.current);
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
      // On a wide map the popup sits under the zoom buttons at the map's
      // right and grows to fit: MapView sets --route-room to the height there
      // is below them, so it scrolls only when it is taller than the map.
      // Elsewhere it keeps the old cap.
      <Box data-route-box ref={boxRef} sx={{ width: 380, maxWidth: "100%", maxHeight: "var(--route-room, min(70vh, 600px))",
        overflowY: "auto", pr: 0.5, fontFamily: "Figtree, Helvetica, Arial, sans-serif" }}>
        {/* Share sits beside the title: it copies a link that reopens this
            popup and its routes, so it is kept apart from Download. Only for
            routes the server kept; a set saved before it did has no id, and
            no Share button. */}
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Typography ref={titleRef} tabIndex={-1} sx={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3, pt: 0.25, outline: "none" }}>
            Alternate routes if {road} closes
          </Typography>
          {ok && (routeId || reopened) && (
            <ShareButton small below title="Copy a link to these routes"
              link={async (c?: string) => shareLink({ tab: "pinch", route: routeId ?? await shareIdFor(reopened!, c) }, true)} />
          )}
        </Stack>
        {/* For testers: a result that does not look right is reported with
            a copy of it. Under the title, away from Share and Download. */}
        <ReportLink build={buildReport} region={() => boxRef.current} sx={{ display: "block", mt: 0.25 }} />
        {reopened?.rebuilt && (
          <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.25 }}>
            Rebuilt from a tester's report. Worked out {savedDate(reopened.saved_at)}, {timeLeft(reopened.expires_at)}.
          </Typography>
        )}
        {reopened && !reopened.shared && (
          <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.25 }}>
            Saved {savedDate(reopened.saved_at)} as "{reopened.name}", {timeLeft(reopened.expires_at)}.
          </Typography>
        )}
        {reopened?.shared && !reopened.rebuilt && (
          <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.25 }}>
            From a shared link. Worked out {savedDate(reopened.saved_at)}, {timeLeft(reopened.expires_at)}.
          </Typography>
        )}
        {/* the result, read out by screen readers once it is back */}
        <Box role="status" sx={VISUALLY_HIDDEN}>
          {ok ? (result.routes.length === 1 ? "1 alternate route is shown." : `${result.routes.length} alternate routes are shown.`)
            : result.message}
        </Box>
        {!ok && <Typography sx={{ fontSize: 13, mt: 0.75, lineHeight: 1.5 }}>{result.message}</Typography>}
        {ok && result.open_road && (
          <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.25 }}>
            Driving this stretch normally: {result.open_road.minutes < 1 ? "under a minute" : mins(result.open_road.minutes)},{" "}
            {miles(result.open_road.miles)}.
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
              {result.routes.length === 1 ? "Only 1 alternate route is shown." : `Only ${result.routes.length} alternate routes are shown.`}
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
                    border: "1px solid", borderColor: lit === i + 1 ? pal.colors[i % 3] : "#d5dae1",
                    boxShadow: lit === i + 1 ? `0 0 0 2px ${pal.colors[i % 3]}` : "none",
                    bgcolor: lit === i + 1 ? "#f4f7fb" : "transparent",
                    // The other rows are not faded: that took their gray text
                    // under 4.5:1. The lit row's border and tint mark it.
                    transition: "box-shadow 120ms",
                    borderRadius: 2, px: 1.25, py: 1,
                  }}>
                  <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                    <Box sx={{
                      width: 20, height: 20, borderRadius: "50%", bgcolor: pal.colors[i % 3], color: pal.inks[i % 3],
                      fontSize: 12, fontWeight: 800, display: "inline-flex", alignItems: "center",
                      justifyContent: "center", flexShrink: 0,
                    }}>{i + 1}</Box>
                    <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
                      {r.extra_minutes > 0 || r.extra_miles > 0
                        ? `${mins(r.extra_minutes)} longer, ${miles(r.extra_miles)} farther`
                        : "No longer than the road itself"}
                    </Typography>
                    <Box component="span" sx={{
                      fontSize: 12, fontWeight: 700, borderRadius: 999, px: 1, py: 0.25, bgcolor: tag.bg, color: tag.ink,
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
                      <Box component="ol" sx={{ m: 0, mt: 0.5, pl: 2.5, fontSize: 13, lineHeight: 1.55 }}>
                        {r.steps.map((s, k) => <li key={k}>{s}</li>)}
                      </Box>
                      <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.5 }}>
                        The whole route: {mins(r.minutes)}, {miles(r.miles)}.{r.note ? ` ${r.note}` : ""}
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
            The "Truck safe" label does not check bridge heights. Look out for low bridges.
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
            <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.5 }}>
              One row per step of each route, with the route's extra time and distance, the direction, and the step's miles.
            </Typography>
          </>
        )}
        {ok && onSave && (!reopened || reopened.shared) && (
          <Box sx={{ mt: 1.25, pt: 1, borderTop: "1px solid #e3e7ea" }}>
            {savedAt ? (
              <Typography ref={savedRef} tabIndex={-1} sx={{ fontSize: 13, fontWeight: 700, color: NIGHT_SKY, outline: "none" }}>
                Saved as "{saveName.trim() || road}". It is in "Your alternate routes" in the panel until {keptUntil}.
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
                <Typography sx={{ fontSize: 12, color: "#57606a", mt: 0.5 }}>
                  Optional. Keeps these routes in this browser until {keptUntil}. Opening them again uses none
                  of today's route requests.
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
      <div ref={htmlRef} dangerouslySetInnerHTML={{ __html: ctx.html }} />
      {/* as wide as the road's text above it */}
      <Box sx={{ mt: 1.25, pt: 1, borderTop: "1px solid #e3e7ea" }}>
        {askCode && (
          <Box component="label" sx={{ display: "flex", flexDirection: "column", gap: 0.5, fontSize: 12, fontWeight: 700 }}>
            Access code
            <Box component="input" type="password" value={code} autoComplete="off" readOnly={busy}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") ask(); }}
              sx={{ font: "400 14px Figtree, Helvetica, Arial, sans-serif", border: "1px solid #b8c0ca",
                borderRadius: 1.5, px: 1.25, py: 0.9 }} />
          </Box>
        )}
        {/* While the routes are on their way it only looks and reads as
            grayed out (aria-disabled), so it keeps keyboard focus; ask()
            ignores a second press. */}
        <Button ref={getRef} fullWidth variant="contained" disableElevation
          disabled={!overtureId || limits?.turned_off === true} aria-disabled={busy || undefined}
          onClick={ask} sx={{
          mt: askCode ? 1 : 0, textTransform: "none", fontWeight: 700, fontSize: 14, bgcolor: BULLDOG_BLUE,
          "&:hover": { bgcolor: NIGHT_SKY },
          ...(busy && { "&, &:hover": { bgcolor: "rgba(0, 0, 0, 0.12)", color: "rgba(0, 0, 0, 0.26)", cursor: "default" } }),
        }}>
          Get alternate and truck-safe routes
        </Button>
        {busy && (
          <Stack role="status" direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75 }}>
            <CircularProgress size={14} thickness={6} sx={{ color: BULLDOG_BLUE }} aria-hidden="true" />
            <Typography sx={{ fontSize: 13 }}>Finding alternate routes...</Typography>
          </Stack>
        )}
        {error && <Box role="alert" sx={{ ...ERROR_BOX_SX, mt: 0.75 }}>{error}</Box>}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
          <Typography sx={{ fontSize: 12, color: "#57606a" }}>
            {!limits ? "" : limits.turned_off
              ? (limits.cap_reached ? "The routes tool is turned off until next month." : "The routes tool is turned off for now.")
              : `${limits.routes_left.toLocaleString()} of ${limits.routes_limit.toLocaleString()} route requests left today`}
          </Typography>
          {/* never on the published site, which asks for the code every time */}
          {!askCode && CODE_REMEMBERED && (
            <Link component="button" underline="hover" sx={{ fontSize: 12, color: BULLDOG_BLUE }}
              onClick={() => { setAskCode(true); setCode(""); }}>
              Change code
            </Link>
          )}
        </Stack>
        {TARGET_SWITCHABLE && !busy && <TargetSwitch onSetup={onSetup} />}
      </Box>
    </Box>
  );
}
