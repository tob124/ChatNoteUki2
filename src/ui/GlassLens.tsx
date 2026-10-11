import { useEffect, useId, useRef, useState } from "react";

// Only geometry enters this image. It never snapshots notes or samples the DOM.
function lensMap(width: number, height: number, radius: number): string {
  const ratio = Math.min(1, 768 / width, 192 / height);
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D geometry map unavailable");
  const pixels = ctx.createImageData(w, h);
  const r = Math.min(radius, width / 2, height / 2);
  const rim = Math.min(18, r * 0.9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = ((x + 0.5) / w - 0.5) * width;
      const py = ((y + 0.5) / h - 0.5) * height;
      const qx = Math.abs(px) - (width / 2 - r);
      const qy = Math.abs(py) - (height / 2 - r);
      const ox = Math.max(qx, 0),
        oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const distance = length + Math.min(Math.max(qx, qy), 0) - r;
      const normalX = length
        ? (ox / length) * Math.sign(px)
        : qx > qy
          ? Math.sign(px)
          : 0;
      const normalY = length
        ? (oy / length) * Math.sign(py)
        : qy >= qx
          ? Math.sign(py)
          : 0;
      const edge =
        distance <= 0 && distance > -rim
          ? Math.pow(1 + distance / rim, 1.4)
          : 0;
      const i = (y * w + x) * 4;
      pixels.data[i] = 128 + normalX * edge * 112;
      pixels.data[i + 1] = 128 + normalY * edge * 112;
      pixels.data[i + 2] = 128;
      pixels.data[i + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Live backdrop refraction; labels and input text stay on the clear foreground. */
export function GlassLens({
  enabled,
  radius = 24,
}: {
  enabled: boolean;
  radius?: number;
}) {
  const id = `lens-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ref = useRef<SVGSVGElement>(null);
  const [map, setMap] = useState("");
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const reduce = matchMedia("(prefers-reduced-transparency: reduce)");
    const contrast = matchMedia("(forced-colors: active)");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastSize = "";
    let observer: ResizeObserver | undefined;
    const update = () => {
      if (!enabled || reduce.matches || contrast.matches) {
        host.style.removeProperty("--lens-filter");
        delete host.dataset.lens;
        setMap("");
        lastSize = "";
        return;
      }
      const { width, height } = host.getBoundingClientRect();
      const key = `${Math.round(width)}:${Math.round(height)}`;
      if (!width || !height || key === lastSize) return;
      try {
        setMap(lensMap(width, height, radius));
        host.style.setProperty("--lens-filter", `url(#${id})`);
        host.dataset.lens = "ready";
        lastSize = key;
      } catch {
        // CSS blur remains available if the map cannot be created.
        host.style.removeProperty("--lens-filter");
        delete host.dataset.lens;
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 80);
    };
    if (enabled) {
      observer = new ResizeObserver(schedule);
      observer.observe(host);
    }
    update();
    reduce.addEventListener("change", schedule);
    contrast.addEventListener("change", schedule);
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      reduce.removeEventListener("change", schedule);
      contrast.removeEventListener("change", schedule);
      host.style.removeProperty("--lens-filter");
      delete host.dataset.lens;
    };
  }, [enabled, id, radius]);
  return (
    <svg
      ref={ref}
      className="glass-lens-defs"
      aria-hidden="true"
      focusable="false"
    >
      {map && (
        <defs>
          <filter
            id={id}
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={map}
              x="0"
              y="0"
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              result="geometry"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="geometry"
              scale="-20"
              xChannelSelector="R"
              yChannelSelector="G"
              result="redLight"
            />
            <feColorMatrix
              in="redLight"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="red"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="geometry"
              scale="-23"
              xChannelSelector="R"
              yChannelSelector="G"
              result="greenLight"
            />
            <feColorMatrix
              in="greenLight"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="green"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="geometry"
              scale="-26"
              xChannelSelector="R"
              yChannelSelector="G"
              result="blueLight"
            />
            <feColorMatrix
              in="blueLight"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="blue"
            />
            <feComposite
              in="red"
              in2="green"
              operator="arithmetic"
              k2="1"
              k3="1"
              result="redGreen"
            />
            <feComposite
              in="redGreen"
              in2="blue"
              operator="arithmetic"
              k2="1"
              k3="1"
            />
          </filter>
        </defs>
      )}
    </svg>
  );
}
