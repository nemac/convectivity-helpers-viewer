import React from "react";
import { createRoot } from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import App from "./App";
import { BULLDOG_BLUE, NIGHT_SKY } from "./brand";

const theme = createTheme({
  typography: {
    fontFamily: "Figtree, Helvetica, Arial, sans-serif",
    // the card titles in the panel: one size and weight on every card
    subtitle2: { fontSize: 14, fontWeight: 700 },
  },
  palette: {
    primary: { main: BULLDOG_BLUE, dark: NIGHT_SKY },
  },
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
