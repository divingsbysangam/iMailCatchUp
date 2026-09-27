import DOMPurify from "dompurify";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * Email HTML is hostile input. Layers of defence:
 * 1. DOMPurify strips scripts, event handlers, forms, iframes, etc. The email's own <style> rules are kept
 *    so it looks the way it does in iCloud.
 * 2. It renders in a sandboxed iframe with no scripts at all. The frame shares this origin only so the
 *    app can measure it (auto height, fit to width); without allow-scripts nothing inside can run.
 * 3. The page CSP (inherited by srcdoc) allows images only from this origin and data: URLs, so remote
 *    images must go through the private image proxy (/api/img): senders never see the reader's IP.
 */

const purify = DOMPurify(window);

/** Remote http(s) URL → same-origin proxy URL. Anything else that isn't data: is dropped. */
export function proxify(raw: string): string {
  const url = raw.trim();
  if (/^data:image\//i.test(url)) return url;
  const abs = url.startsWith("//") ? `https:${url}` : url;
  if (/^https?:\/\//i.test(abs)) return `/api/img?u=${encodeURIComponent(abs)}`;
  return "";
}

/** Rewrites url(...) in CSS and removes @import (remote stylesheets are blocked anyway). */
export function proxifyCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, _q, u: string) => {
      const p = proxify(u);
      return p ? `url("${p}")` : "none";
    });
}

const URL_ATTRS = ["src", "background", "poster"];

purify.addHook("afterSanitizeAttributes", (node) => {
  for (const attr of URL_ATTRS) {
    const v = node.getAttribute(attr);
    if (v !== null) {
      const p = proxify(v);
      if (p) node.setAttribute(attr, p);
      else node.removeAttribute(attr);
    }
  }
  const style = node.getAttribute("style");
  if (style && /url\(|@import/i.test(style)) node.setAttribute("style", proxifyCss(style));
  if (node.nodeName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});
purify.addHook("afterSanitizeElements", (node) => {
  if (node.nodeName === "STYLE" && node.textContent) node.textContent = proxifyCss(node.textContent);
});

/**
 * Defaults a mail app applies before the email's own styles (which come later and win): a margin that
 * lines up with the app around it, a readable system font for unstyled mail, and images that never
 * overflow the reading width.
 */
const baseCss = (inset: number) => `
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;padding:16px ${inset}px;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;color:#1d1d1f;background:#fff;overflow-wrap:break-word}
img{max-width:100%}
img:not([height]){height:auto}
pre{white-space:pre-wrap}
`;

export function buildSrcDoc(html: string, inset = 16): string {
  const doc = purify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "iframe", "object", "embed", "link", "meta", "base", "script", "frame", "frameset"],
    FORBID_ATTR: ["srcset"],
  }) as string;
  const head = `<meta charset="utf-8"><base target="_blank"><style>${baseCss(inset)}</style>`;
  return `<!doctype html>${doc.replace(/<head>/i, `<head>${head}`)}`;
}

/** The email body, sized to its content and scaled down to fit narrow screens (like Apple Mail). */
export function EmailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  // Side margin inside the email = the page margin around it (CSS --email-inset), so text lines up.
  const [inset, setInset] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (ref.current) setInset(parseFloat(getComputedStyle(ref.current).getPropertyValue("--email-inset")) || 16);
  }, []);
  const srcDoc = useMemo(() => (inset === null ? "" : buildSrcDoc(html, inset)), [html, inset]);
  const [height, setHeight] = useState(240);

  useEffect(() => {
    const frame = ref.current;
    if (!frame || !srcDoc) return;
    let observer: ResizeObserver | undefined;
    let lastWidth = 0;
    const outer = new ResizeObserver(() => {
      if (frame.clientWidth !== lastWidth) fit(); // our own height changes don't need a re-fit
    });

    /** Height only: images arriving, fonts, late layout. */
    function measure() {
      const doc = frame!.contentDocument;
      const body = doc?.body;
      if (!doc || !body) return;
      const scale = Number(body.dataset.scale ?? 1);
      const marginBottom = parseFloat(doc.defaultView?.getComputedStyle(body).marginBottom ?? "0") || 0;
      const h = Math.ceil(body.getBoundingClientRect().bottom + marginBottom * scale);
      setHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
    }

    /** Width: scale wide (e.g. 600px newsletter) layouts down to the frame, then measure. */
    function fit() {
      const doc = frame!.contentDocument;
      const body = doc?.body;
      if (!doc || !body) return;
      body.style.transform = "";
      body.style.width = "";
      body.style.boxSizing = "";
      doc.documentElement.style.overflow = "hidden";
      const available = (lastWidth = frame!.clientWidth);
      const overflow = Math.max(doc.documentElement.scrollWidth, body.scrollWidth);
      // Overflowing content doesn't count the body's end padding; add it back so margins stay even.
      const natural = overflow > available + 1 ? overflow + (parseFloat(doc.defaultView?.getComputedStyle(body).paddingRight ?? "0") || 0) : available;
      const scale = natural > available + 1 ? available / natural : 1;
      body.dataset.scale = String(scale);
      if (scale < 1) {
        body.style.boxSizing = "border-box";
        body.style.width = `${natural}px`;
        body.style.transformOrigin = "0 0";
        body.style.transform = `scale(${scale})`;
      }
      measure();
    }

    const onLoad = () => {
      fit();
      const win = frame.contentWindow as (Window & typeof globalThis) | null;
      if (!win || !frame.contentDocument?.body) return;
      observer?.disconnect();
      observer = new win.ResizeObserver(() => measure());
      observer.observe(frame.contentDocument.body);
      // A late image can make the layout wider than the frame: fit again once it arrives.
      frame.contentDocument.querySelectorAll("img").forEach((img) => img.addEventListener("load", fit, { once: true }));
    };
    frame.addEventListener("load", onLoad);
    if (frame.contentDocument?.readyState === "complete" && frame.contentDocument.body?.childNodes.length) onLoad();
    outer.observe(frame);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
      outer.disconnect();
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      title="Email content"
      className="email-frame"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      style={{ height }}
    />
  );
}
