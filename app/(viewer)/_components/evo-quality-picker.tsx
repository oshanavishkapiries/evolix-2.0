"use client";

import Link from "next/link";
import { imageUrl } from "@/lib/images";
import "../styles/evo-progress.css";

export type EvoQuality = "1080p" | "720p" | "480p";

type Props = {
  title: string;
  backdropPath?: string | null;
  selectedQuality: EvoQuality;
  onSelectQuality: (q: EvoQuality) => void;
  onConfirm: () => void;
  backHref: string;
};

const QUALITIES: Array<{
  id: EvoQuality;
  label: string;
  resolution: string;
  description: string;
  tag: string;
}> = [
  {
    id: "1080p",
    label: "Full HD",
    resolution: "1080p",
    description: "Maximum detail & crisp clarity. Best for large displays.",
    tag: "Recommended",
  },
  {
    id: "720p",
    label: "Standard HD",
    resolution: "720p",
    description: "Faster buffering with great definition on any screen.",
    tag: "Balanced",
  },
  {
    id: "480p",
    label: "Data Saver",
    resolution: "480p",
    description: "Lowest data consumption, instant loading on weak networks.",
    tag: "Fast Start",
  },
];

export function EvoQualityPicker({
  title,
  backdropPath,
  selectedQuality,
  onSelectQuality,
  onConfirm,
  backHref,
}: Props) {
  const bg = backdropPath ? imageUrl(backdropPath, "w1280") : null;

  return (
    <div className="evo-screen">
      {bg && <div className="evo-backdrop" style={{ backgroundImage: `url("${bg}")` }} />}

      <div className="evo-container">
        <div className="evo-header">
          <span className="evo-badge">
            <span style={{ width: ".5rem", height: ".5rem", borderRadius: "50%", background: "var(--v-primary)" }} />
            Evo Engine On-Demand
          </span>
          <h1 className="evo-title">{title}</h1>
          <p className="evo-status-message">
            Select playback quality to start on-demand stream
          </p>
        </div>

        <div className="evo-quality-list" role="radiogroup" aria-label="Select streaming quality">
          {QUALITIES.map((q) => {
            const isSelected = selectedQuality === q.id;
            return (
              <div
                key={q.id}
                role="radio"
                tabIndex={0}
                aria-checked={isSelected}
                className="evo-quality-card"
                data-selected={isSelected}
                onClick={() => onSelectQuality(q.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectQuality(q.id);
                  }
                }}
              >
                <div className="evo-quality-main">
                  <div className="evo-quality-radio">
                    <div className="evo-quality-radio-inner" />
                  </div>
                  <div className="evo-quality-info">
                    <div className="evo-quality-name">
                      <span>{q.label}</span>
                      <small style={{ color: "var(--v-primary)", fontWeight: 700 }}>{q.resolution}</small>
                    </div>
                    <span className="evo-quality-desc">{q.description}</span>
                  </div>
                </div>
                <span className="evo-quality-tag">{q.tag}</span>
              </div>
            );
          })}
        </div>

        <div className="evo-actions">
          <button
            type="button"
            className="v-btn v-btn-primary"
            onClick={onConfirm}
            style={{ minWidth: "10rem" }}
          >
            Start Streaming ({selectedQuality})
          </button>
          <Link href={backHref} className="v-btn">
            Back to Details
          </Link>
        </div>
      </div>
    </div>
  );
}
