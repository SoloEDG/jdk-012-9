import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Point } from "../../../shared/types";
import { buildScene, disposeScene } from "../lib/buildScene";
export function Viewport({
  position,
  yaw,
  onSelect,
}: {
  position: React.RefObject<Point>;
  yaw: React.RefObject<number>;
  onSelect: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const [error, setError] = useState("");
  useEffect(() => {
    const el = root.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError("当前设备无法启动三维画面，可继续通过作品列表参观。");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const { scene, frames, sculpture } = buildScene();
    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 80);
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    let frame = 0;
    let dragging = false,
      moved = 0,
      last = 0;
    const down = (e: PointerEvent) => {
      dragging = true;
      last = e.clientX;
      moved = 0;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (dragging) {
        const delta = e.clientX - last;
        yaw.current -= delta * 0.005;
        moved += Math.abs(delta);
        last = e.clientX;
      }
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      if (moved < 5) {
        const rect = el.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(
          new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            (-(e.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        );
        const hit = ray.intersectObjects(frames)[0];
        if (hit) select.current(hit.object.userData.artworkId);
      }
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    const tick = (now: number) => {
      camera.position.set(position.current.x, 1.7, position.current.z);
      camera.rotation.set(-0.03, yaw.current, 0);
      sculpture.rotation.y = now * 0.00015;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [position, yaw]);
  return (
    <div className="viewport" ref={root}>
      {error && <div className="webgl-error">{error}</div>}
    </div>
  );
}
