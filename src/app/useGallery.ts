import { useEffect, useRef } from "react";
import { useWalker, distance, viewingPoint } from "../features/space";
import { useCatalog } from "../features/catalog";
import { useNarration } from "../features/narration";
import { useTour } from "../features/tours";
import { useCollection } from "../features/collection";
import { artworkById } from "../shared/catalog";
export function useGallery() {
  const catalog = useCatalog();
  const tour = useTour();
  const collection = useCollection();
  const walker = useWalker(catalog.observe);
  const narration = useNarration(() => {
    if (tour.state.phase === "listening") tour.next();
  });
  const go = (id: string) => {
    const a = artworkById(id);
    if (a) {
      catalog.select(id);
      walker.go(viewingPoint(a.position, a.facing));
      walker.yaw.current = a.facing;
    }
  };
  useEffect(() => {
    if (tour.state.phase === "walking" && tour.target) go(tour.target);
  }, [tour.state.phase, tour.target]);
  useEffect(() => {
    if (tour.state.phase !== "walking" || !tour.target) return;
    const a = artworkById(tour.target)!;
    if (distance(walker.position, viewingPoint(a.position, a.facing)) < 0.15) {
      tour.arrive();
      narration.play(a.id);
    }
  }, [walker.position, tour.state.phase, tour.target]);
  const current = useRef({ nearby: catalog.nearby, record: collection.record });
  current.current = { nearby: catalog.nearby, record: collection.record };
  useEffect(() => {
    const t = setInterval(() => {
      if (current.current.nearby)
        current.current.record(current.current.nearby, 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);
  return {
    catalog,
    tour,
    collection,
    walker,
    narration,
    go,
    pauseTour: () => {
      tour.pause();
      walker.stop();
      narration.pause();
    },
    stopTour: () => {
      tour.stop();
      walker.stop();
      narration.pause();
    },
    nextTour: () => {
      walker.stop();
      narration.pause();
      tour.next();
    },
  };
}
