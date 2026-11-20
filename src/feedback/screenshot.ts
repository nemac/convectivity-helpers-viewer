// A picture of the whole viewer, saved with each item so whoever reads the
// feedback sees what the tester saw. JPEG at quality 0.7, one image pixel per
// CSS pixel. The map's canvas keeps its drawing buffer (preserveDrawingBuffer
// in MapView), which is what lets it be copied. Anything that goes wrong
// gives null, and the item is saved without a picture.
//
// html-to-image is loaded the first time a picture is taken, so visitors who
// never give feedback do not download it with the rest of the viewer.
import { SKIP_ATTR } from "./target";

// The server refuses pictures over about 1.5 MB.
const MAX_BYTES = 1_400_000;

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("too slow")), ms);
    p.then((v) => { window.clearTimeout(t); resolve(v); }, (e) => { window.clearTimeout(t); reject(e); });
  });
}

// The page's fonts, read once and reused, so the picture is in Figtree
// without fetching the font files again for every item.
let fonts: Promise<string> | null = null;

const blobToDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});

// The @font-face rules of this site's own stylesheets, with each font file
// put inline. Done here rather than by html-to-image's getFontEmbedCSS,
// which also reads the map's stylesheet from unpkg: the browser will not let
// a page read another site's rules, and the library logged dozens of errors
// on the first picture of each visit trying, and fetched made-up addresses
// from that sheet's inline icons. The map's stylesheet has no fonts, so
// nothing is lost by skipping it.
async function ownFontCSS(): Promise<string> {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.href && new URL(sheet.href, document.baseURI).origin !== window.location.origin) continue;
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    const base = sheet.href ?? document.baseURI;
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      let css = rule.cssText;
      for (const m of Array.from(css.matchAll(/url\((['"]?)([^'")]+)\1\)/g))) {
        if (m[2].startsWith("data:")) continue;
        try {
          const res = await fetch(new URL(m[2], base).href);
          if (!res.ok) continue;
          css = css.replace(m[0], `url("${await blobToDataUrl(await res.blob())}")`);
        } catch { /* left as it was; that font falls back in the picture */ }
      }
      out.push(css);
    }
  }
  return out.join("\n");
}

const bytesOf = (b64: string) => Math.floor((b64.length * 3) / 4);

// html-to-image copies each element's computed style into the picture but
// not how far it is scrolled, so the side panel and the Methodology reader
// came out scrolled to the top while the outline stayed where the item was
// on screen, around the wrong words. While the picture is taken, each
// scrolled box is set back to the top and its children are moved up by the
// same amount (the CSS translate property, which leaves any transform they
// have alone), which looks the same on screen and in the copy. The returned
// function puts it all back, adding any scrolling done meanwhile.
function holdScroll(): () => void {
  const undo: (() => void)[] = [];
  const instant = { top: 0, left: 0, behavior: "instant" as ScrollBehavior };
  for (const box of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
    const top = box.scrollTop, left = box.scrollLeft;
    if (!top && !left) continue;
    if (box.closest(`[${SKIP_ATTR}]`)) continue;            // left out of the picture anyway
    // Words directly inside the box cannot be moved on their own, and a
    // child that already has a translate would lose it: such a box is left
    // as it is, scrolled to the top in the picture as before.
    if (Array.from(box.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue;
    const kids = Array.from(box.children).filter((c): c is HTMLElement | SVGElement =>
      c instanceof HTMLElement || c instanceof SVGElement);
    if (kids.some((c) => { const t = getComputedStyle(c).translate; return !!t && t !== "none"; })) continue;
    const before = kids.map((c) => c.style.translate);
    kids.forEach((c) => { c.style.translate = `${-left}px ${-top}px`; });
    box.scrollTo(instant);
    undo.push(() => {
      const moreTop = box.scrollTop, moreLeft = box.scrollLeft;
      kids.forEach((c, i) => { c.style.translate = before[i]; });
      box.scrollTo({ top: top + moreTop, left: left + moreLeft, behavior: "instant" as ScrollBehavior });
    });
  }
  return () => { undo.reverse().forEach((f) => { try { f(); } catch { /* that box is gone */ } }); };
}

let lib: Promise<typeof import("html-to-image")> | null = null;

export async function captureView(): Promise<string | null> {
  try {
    if (!lib) lib = import("html-to-image");
    const { toJpeg } = await within(lib, 10000).catch((e) => { lib = null; throw e; });
    const node = document.body;
    if (!fonts) fonts = ownFontCSS().catch(() => "");
    const css = await within(fonts, 5000).catch(() => "");
    const opts = {
      quality: 0.7, pixelRatio: 1, width: window.innerWidth, height: window.innerHeight,
      backgroundColor: "#ffffff", cacheBust: false,
      ...(css ? { fontEmbedCSS: css } : { skipFonts: true }),
      filter: (n: HTMLElement) => !(n.nodeType === 1 && n.hasAttribute?.(SKIP_ATTR)),
    };
    // Held until both tries are done: the copy is made inside toJpeg, and
    // nothing says when within it.
    const release = holdScroll();
    let b64: string;
    try {
      let url = await within(toJpeg(node, opts), 12000);
      b64 = url.replace(/^data:image\/jpeg;base64,/, "");
      if (bytesOf(b64) > MAX_BYTES) {
        url = await within(toJpeg(node, { ...opts, quality: 0.45 }), 12000);
        b64 = url.replace(/^data:image\/jpeg;base64,/, "");
      }
    } finally {
      release();
    }
    return b64 && bytesOf(b64) <= MAX_BYTES ? b64 : null;
  } catch {
    return null;
  }
}
