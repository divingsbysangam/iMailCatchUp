import { useEffect, useRef } from "react";
import { mountOrb, type OrbState } from "./orb";

export function Orb({ state, size }: { state: OrbState; size: 22 | 48 | 64 }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) mountOrb(ref.current, state, size);
  }, [state, size]);
  return <canvas ref={ref} className="orb" width={size} height={size} />;
}
