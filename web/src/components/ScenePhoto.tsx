import { useState } from 'react';

/**
 * Scene/Photo (Figma 14:373): latar layar tamu.
 * Memakai public/bg/background.jpg bila ada; kalau belum ada, yang terlihat gradien sunset (.scene).
 */
export function ScenePhoto() {
  const [missing, setMissing] = useState(false);
  return (
    <div className="scene">
      {!missing && (
        <img className="scene__image" src="/bg/background.jpg" alt="" draggable={false} onError={() => setMissing(true)} />
      )}
    </div>
  );
}
