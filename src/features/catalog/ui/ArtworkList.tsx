import { artworks } from "../../../shared/catalog";
import { ArrowUpRight } from "lucide-react";
export function ArtworkList({
  active,
  onSelect,
}: {
  active: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="artwork-list">
      {artworks.map((a, i) => (
        <button
          className={active === a.id ? "art-row active" : "art-row"}
          onClick={() => onSelect(a.id)}
          key={a.id}
        >
          <span className="art-number">0{i + 1}</span>
          <span>
            <strong>{a.title}</strong>
            <small>
              {a.artist} · {a.year}
            </small>
          </span>
          <ArrowUpRight size={16} />
        </button>
      ))}
    </div>
  );
}
