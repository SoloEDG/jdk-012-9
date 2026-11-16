import { Route, ArrowRight, Pause, Play, X } from "lucide-react";
import { routes, artworkById } from "../../../shared/catalog";
import type { TourState } from "../../../shared/types";
import { tourProgress, tourRoute } from "../lib/routeProgress";
export function TourPanel({
  state,
  onStart,
  onPause,
  onResume,
  onStop,
  onNext,
}: {
  state: TourState;
  onStart: (id: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onNext: () => void;
}) {
  const current = tourRoute(state);
  return (
    <section className="tour-panel">
      <div className="section-title">
        <Route size={16} />
        <span>主题导览</span>
        <small>CURATED JOURNEYS</small>
      </div>
      {current && state.phase !== "idle" ? (
        <div className="current-tour">
          <span className="eyebrow">
            正在探索 ·{" "}
            {state.phase === "done"
              ? "已完成"
              : `${state.step + 1} / ${current.stops.length}`}
          </span>
          <h3>{current.name}</h3>
          <progress value={tourProgress(state)} max="1" />
          <p>
            {state.phase === "done"
              ? "这段旅程已完成，收藏你的所见。"
              : `${state.phase === "walking" ? "正在前往" : state.phase === "paused" ? "导览已暂停" : "正在讲解"} · ${artworkById(current.stops[state.step])?.title}`}
          </p>
          <div className="tour-controls">
            {state.phase !== "done" && (
              <>
                <button onClick={state.phase === "paused" ? onResume : onPause}>
                  {state.phase === "paused" ? (
                    <Play size={14} />
                  ) : (
                    <Pause size={14} />
                  )}{" "}
                  {state.phase === "paused" ? "继续" : "暂停"}
                </button>
                <button onClick={onNext}>
                  下一站
                  <ArrowRight size={14} />
                </button>
              </>
            )}
            <button aria-label="结束导览" onClick={onStop}>
              <X size={14} />
            </button>
          </div>
        </div>
      ) : (
        routes.map((r, i) => (
          <button
            className={"route-card route-" + i}
            key={r.id}
            onClick={() => onStart(r.id)}
          >
            <span>
              JOURNEY 0{i + 1} <span>约 {i ? 3 : 2} 分钟 · 3 件作品</span>
            </span>
            <h3>
              {r.name}
              <ArrowUpRightIcon />
            </h3>
            <p>{r.subtitle}</p>
          </button>
        ))
      )}
    </section>
  );
}
function ArrowUpRightIcon() {
  return <span className="round-arrow">↗</span>;
}
