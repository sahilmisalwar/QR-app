import { ScanLine, QrCode } from "lucide-react";
import "./scan-capture.css";

export function ScanCapture() {
  return (
    <section className="scan-capture" role="status" aria-atomic="true">
      <div className="capture-stage" aria-hidden="true">
        <div className="capture-reticle">
          <i /><i /><i /><i />
        </div>
        <div className="capture-pass">
          <span className="capture-slot" />
          <QrCode size={66} strokeWidth={2.3} />
          <span className="capture-print" />
        </div>
        <div className="capture-ray" />
        <div className="capture-stamp"><ScanLine size={19} /></div>
      </div>
      <h2>QR scanned</h2>
      <p>Looking up the team…</p>
    </section>
  );
}
