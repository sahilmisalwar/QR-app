import { useLayoutEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import "./receipt-success.css";

export function ReceiptSuccess() {
  const hero = useRef<HTMLElement>(null);
  const [play, setPlay] = useState(0);

  useLayoutEffect(() => {
    const panel = hero.current;
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
      panel.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, []);

  return (
    <header ref={hero} className="receipt-hero">
      <div key={play} className="receipt-sequence" data-replay={play > 0 || undefined}>
        <div className="receipt-medal" aria-hidden="true">
          <svg viewBox="0 0 100 100" fill="none">
            <circle className="receipt-track" cx="50" cy="50" r="44" />
            <circle className="receipt-orbit" cx="50" cy="50" r="44" pathLength="100" />
            <path className="receipt-tick" d="m29 49 14 14 28-30" pathLength="100" />
          </svg>
        </div>
        <h2>Check-in Successful!</h2>
      </div>
      <button type="button" className="receipt-replay" aria-label="Replay success animation"
        title="Replay success animation" onClick={() => setPlay((count) => count + 1)}>
        <RotateCcw size={17} aria-hidden="true" />
      </button>
    </header>
  );
}
