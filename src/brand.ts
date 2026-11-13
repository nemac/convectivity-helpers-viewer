// UNC Asheville brand colours, from the university's graphic standards:
// https://communication.unca.edu/design/color-palette/
//
// Bulldog Blue is the signature colour and carries the primary interface
// elements. Night Sky is the darker navy used where blue sits behind text or
// needs to recede, such as the header band.
export const BULLDOG_BLUE = "#003DA5";   // PANTONE 293
export const NIGHT_SKY = "#003865";      // PANTONE 2955

// The centre the work comes out of, shown in the header.
export const ORG_NAME = "UNCA National Environmental Mapping and Applications Center";
export const ORG_SHORT = "NEMAC";
export const ORG_URL = "https://nemac.unca.edu/";

// The horizontal reversed (white) lockup: the UNC Asheville mark, a rule, then
// NEMAC over the centre's current name. It is an SVG with a 1280x239.97
// viewBox, copied unchanged from "NEMAC_logo_horizontal_white.svg". It is
// white on transparent, so it only reads against a dark band: keep it on
// NIGHT_SKY or BULLDOG_BLUE, never on the light panel.
//
// The filename carries the variant rather than being a generic "logo.svg", so
// swapping in a different mark cannot be masked by a stale browser cache at
// the old URL.
export const ORG_LOGO = "brand/nemac-unca-logo-h-white.svg";
