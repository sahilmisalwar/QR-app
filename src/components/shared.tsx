import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { DoorOpen, Utensils, Moon, X } from "lucide-react";
import type { Mode } from "../lib/types";
export const modeIcons = { entry: DoorOpen, lunch: Utensils, dinner: Moon };
export function Brand() {
  return (
    <div className="brand-lockup">
      <img src="/brand/rising-india.png" alt="Rising India Hackathon 2.0" />
      <span />
      <img src="/brand/nit.png" alt="Nagpur Institute of Technology" />
      <span />
      <img src="/brand/nexus.png" alt="Team Nexus" />
    </div>
  );
}
export function ModeIcon({ mode, size = 20 }: { mode: Mode; size?: number }) {
  const Icon = modeIcons[mode];
  return <Icon size={size} />;
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog ref={ref} className="modal" onCancel={onClose}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function downloadFile(
  name: string,
  content: BlobPart,
  mime = "text/csv;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
