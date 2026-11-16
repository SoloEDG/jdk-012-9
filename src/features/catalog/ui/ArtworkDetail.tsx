import { Heart, Headphones, ArrowUpRight } from "lucide-react";
import { artworkById } from "../../../shared/catalog";
export function ArtworkDetail({
  id,
  saved,
  onFavorite,
  onListen,
  onGo,
}: {
  id: string | null;
  saved: boolean;
  onFavorite: () => void;
  onListen: () => void;
  onGo: () => void;
}) {
  const a = artworkById(id);
  if (!a) return <div>靠近一件作品，开始探索。</div>;
  return (
    <section className="detail">
      <div className="eyebrow">
        ARTWORK INSIGHT <span>作品档案</span>
      </div>
      <div className={"art-preview art-" + a.id}>
        <span>{a.en}</span>
      </div>
      <div className="detail-heading">
        <h2>{a.title}</h2>
        <button
          className={saved ? "icon-button saved" : "icon-button"}
          aria-label={saved ? "取消收藏" : "收藏作品"}
          onClick={onFavorite}
        >
          <Heart size={20} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      <p className="artist">
        {a.artist} <span>/</span> {a.year}
      </p>
      <p className="medium">{a.medium}</p>
      <p className="description">{a.description}</p>
      <div className="detail-actions">
        <button className="primary" onClick={onListen}>
          <Headphones size={16} />
          收听作品讲解
        </button>
        <button className="text-button" onClick={onGo}>
          前往作品
          <ArrowUpRight size={16} />
        </button>
      </div>
    </section>
  );
}
