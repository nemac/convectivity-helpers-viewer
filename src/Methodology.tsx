import { useEffect, useState } from "react";
import { Box, CircularProgress, Drawer, IconButton, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { marked } from "marked";
import { BULLDOG_BLUE } from "./brand";

// The technical notes are rendered from the repo's own .md files, fetched and
// converted here rather than kept as a second HTML copy. The markdown stays the
// single source: the same files feed the methods PDFs.
//
// The styling below is the viewer's, not a generic markdown theme, so a reader
// moving between the map and the notes stays in one document.

interface Props {
  file: string | null;          // e.g. run-detour-technical.md
  title: string;
  onClose: () => void;
  width: number;
}

export default function Methodology({ file, title, onClose, width }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) { setHtml(null); setError(null); return; }
    let live = true;
    setHtml(null);
    setError(null);
    fetch(new URL(`docs/${file}`, document.baseURI).href)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then((md) => {
        if (!live) return;
        // The notes open with an H1 that repeats the drawer's own title, so it
        // is dropped to avoid showing the heading twice.
        const body = md.replace(/^#\s+.*\n/, "");
        setHtml(marked.parse(body, { async: false }) as string);
      })
      .catch((e) => live && setError(String(e.message ?? e)));
    return () => { live = false; };
  }, [file]);

  return (
    <Drawer anchor="right" open={!!file} onClose={onClose}
      PaperProps={{
        sx: { width, maxWidth: "95vw" },
        // a dialog to screen readers, named by its title
        role: "dialog", "aria-modal": true, "aria-labelledby": "notes-title",
        // the file shown, so feedback left in the reader says which note
        // it is about and Show in the inbox can tell whether it is open
        "data-doc": file ?? undefined,
      } as object}>
      <Box sx={{ p: 3 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" id="notes-title">{title}</Typography>
          </Box>
          {/* The same X icon as every other close button (an icon, not a
              character: Figtree has no glyph for a close symbol). */}
          <IconButton size="small" onClick={onClose} aria-label="Close the notes" title="Close the notes">
            <CloseIcon aria-hidden="true" sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>

        {error && (
          <Typography variant="body2" sx={{
            px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: "#fff1c7", color: "#6b4b00", fontWeight: 700,
          }}>
            This note could not be opened. Try again.
          </Typography>
        )}
        {!html && !error && (
          <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={28} /></Stack>
        )}
        {html && <Box sx={MD_SX} dangerouslySetInnerHTML={{ __html: html }} />}
      </Box>
    </Drawer>
  );
}

// Markdown styled as the rest of the viewer: Figtree throughout, Bulldog Blue
// for links and rules, and tables that match the panels.
const MD_SX = {
  fontSize: 14,
  lineHeight: 1.65,
  color: "#222",
  "& h2": { fontSize: 20, fontWeight: 700, mt: 4, mb: 1, pb: 0.5, borderBottom: `2px solid ${BULLDOG_BLUE}` },
  "& h3": { fontSize: 16, fontWeight: 700, mt: 3, mb: 1, color: BULLDOG_BLUE },
  "& h4": { fontSize: 14, fontWeight: 700, mt: 2, mb: 0.5 },
  "& p": { mt: 0, mb: 1.5 },
  "& ul, & ol": { pl: 3, mb: 1.5 },
  "& li": { mb: 0.5 },
  "& a": { color: BULLDOG_BLUE },
  "& hr": { border: 0, borderTop: "1px solid #ddd", my: 3 },
  "& code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12.5, bgcolor: "#f4f6f8", px: 0.75, py: 0.25, borderRadius: 0.75,
  },
  "& pre": {
    bgcolor: "#f4f6f8", p: 1.5, borderRadius: 1.5, overflowX: "auto",
    border: "1px solid #e3e7ea", mb: 2,
  },
  "& pre code": { bgcolor: "transparent", p: 0, fontSize: 12.5 },
  "& table": { borderCollapse: "collapse", width: "100%", mb: 2, fontSize: 13 },
  "& th": {
    textAlign: "left", bgcolor: "#f4f6f8", fontWeight: 700,
    p: 1, border: "1px solid #e3e7ea",
  },
  "& td": { p: 1, border: "1px solid #e3e7ea", verticalAlign: "top" },
  "& strong": { fontWeight: 700 },
  "& blockquote": {
    m: 0, pl: 2, borderLeft: `3px solid ${BULLDOG_BLUE}`, color: "#555", fontStyle: "italic",
  },
} as const;
