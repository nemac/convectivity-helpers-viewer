import React from "react";
import { Box, Typography } from "@mui/material";

// MapLibre throws during construction when the browser cannot give it a WebGL
// context, which happens on machines with GPU acceleration switched off and in
// headless screenshots. Without a boundary that throw unmounts the whole app
// and the page goes white, hiding the panel and the legend along with the map.
// Catching it here keeps everything else usable and says what went wrong.
interface Props { children: React.ReactNode }
interface State { error: Error | null }

export default class MapBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Map failed to start:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const webgl = /webgl/i.test(this.state.error.message);
    return (
      <Box sx={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center",
        justifyContent: "center", bgcolor: "#f4f6f8", p: 4,
      }}>
        <Box sx={{ maxWidth: 420, textAlign: "center" }}>
          <Typography variant="h6" gutterBottom>The map could not start</Typography>
          <Typography variant="body2" color="text.secondary">
            {webgl
              ? "This browser could not draw the map. Turn on hardware acceleration in the browser's settings, then reload the page."
              : this.state.error.message}
          </Typography>
        </Box>
      </Box>
    );
  }
}
