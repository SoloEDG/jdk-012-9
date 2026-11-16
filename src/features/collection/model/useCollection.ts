import { useState, useEffect } from "react";
import { loadDocument, saveDocument } from "../../../shared/storage";
import { artworkById } from "../../../shared/catalog";
export function useCollection() {
  const [document, setDocument] = useState(loadDocument);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    setStorageError(!saveDocument(document));
  }, [document]);
  return {
    document,
    storageError,
    toggle: (id: string) =>
      setDocument((d) => ({
        ...d,
        favorites: d.favorites.includes(id)
          ? d.favorites.filter((x) => x !== id)
          : [...d.favorites, id],
      })),
    note: (id: string, text: string) =>
      setDocument((d) => ({ ...d, notes: { ...d.notes, [id]: text } })),
    record: (id: string, seconds: number) => {
      if (!artworkById(id)) return;
      setDocument((d) => {
        const previous = d.visits.find((v) => v.id === id);
        return {
          ...d,
          visits: previous
            ? d.visits.map((v) =>
                v.id === id ? { ...v, seconds: v.seconds + seconds } : v,
              )
            : [...d.visits, { id, seconds, at: Date.now() }],
        };
      });
    },
  };
}
