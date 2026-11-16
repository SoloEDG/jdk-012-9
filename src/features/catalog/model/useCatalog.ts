import { useState } from "react";
import type { Point } from "../../../shared/types";
import { nearbyArtwork } from "../lib/proximity";
export function useCatalog() {
  const [active, setActive] = useState<string | null>("a1");
  const [nearby, setNearby] = useState<string | null>(null);
  return {
    active,
    nearby,
    select: setActive,
    observe: (p: Point) => {
      const id = nearbyArtwork(p);
      setNearby(id);
      if (id) setActive(id);
    },
  };
}
