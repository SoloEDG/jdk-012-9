import * as THREE from "three";
import type { Artwork } from "../../../shared/types";
export function artTexture(a: Artwork): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 700;
  c.height = 850;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e3dfd4";
  g.fillRect(0, 0, 700, 850);
  let seed = Number(a.id.slice(1)) * 7919;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  if (a.id === "a1") {
    for (let n = 0; n < 11; n++) {
      g.beginPath();
      g.moveTo(0, 850);
      for (let x = 0; x <= 700; x += 4)
        g.lineTo(
          x,
          210 + n * 48 + Math.sin(x / 115 + n) * 90 + Math.sin(x / 40 + n) * 20,
        );
      g.lineTo(700, 850);
      g.fillStyle = [
        "#d1d9c9",
        "#bac8b6",
        "#a6bca8",
        "#88a18e",
        "#678a79",
        "#436d60",
      ][n % 6];
      g.fill();
    }
  } else if (a.id === "a2") {
    g.fillStyle = "#b6b0c6";
    g.fillRect(0, 0, 700, 850);
    for (let n = 0; n < 100; n++) {
      g.beginPath();
      for (let x = 0; x <= 700; x += 5) {
        const y = 200 + n * 7 + Math.sin(x / 130 + n / 14) * 85;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = `rgba(244,236,255,${0.1 + rnd() * 0.5})`;
      g.stroke();
    }
  } else if (a.id === "a3") {
    g.fillStyle = "#e2c4a5";
    g.fillRect(0, 0, 700, 850);
    for (let n = 0; n < 18; n++) {
      g.fillStyle = ["#c66d45", "#edab70", "#8b4939", "#e6ce9f"][n % 4];
      g.fillRect(rnd() * 650, rnd() * 800, 30 + rnd() * 230, 40 + rnd() * 330);
    }
  } else if (a.id === "a4") {
    g.fillStyle = "#a2bac0";
    g.fillRect(0, 0, 700, 850);
    for (let n = 0; n < 100; n++) {
      let x = rnd() * 700,
        y = rnd() * 850;
      g.fillStyle = ["#29464f", "#527983", "#d5d8c9"][n % 3];
      g.fillRect(x, y, 20 + rnd() * 80, 40 + rnd() * 140);
      g.strokeStyle = "#c2dddd";
      g.strokeRect(x, y, 20, 65);
    }
  } else if (a.id === "a5") {
    g.fillStyle = "#18261f";
    g.fillRect(0, 0, 700, 850);
    for (let n = 0; n < 3500; n++) {
      const t = rnd() * Math.PI * 2,
        r = Math.sqrt(rnd()) * 280;
      g.fillStyle = ["#c7d297", "#768953", "#d8b76d"][n % 3];
      g.globalAlpha = rnd();
      g.beginPath();
      g.arc(
        350 + Math.cos(t) * r,
        425 + Math.sin(t) * r * 1.2,
        rnd() * 2.5,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
    g.globalAlpha = 1;
  } else {
    g.fillStyle = "#c9bcab";
    g.fillRect(0, 0, 700, 850);
    for (let n = 0; n < 9; n++) {
      g.save();
      g.translate(350, 420);
      g.rotate(n * 0.22);
      g.strokeStyle = n % 2 ? "#736b62" : "#eee4d8";
      g.lineWidth = 18;
      g.beginPath();
      g.ellipse(0, 0, 95 + n * 15, 240, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }
  return new THREE.CanvasTexture(c);
}
